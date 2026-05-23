"""
Insurance Multi-Agent System API Server
This server exposes your Jupyter notebook multi-agent system as a REST API
"""

import os
import json
import sqlite3
import logging
import time
import re
import requests
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from dotenv import load_dotenv
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from textblob import TextBlob

# Load environment variables
load_dotenv()

# Import your existing multi-agent system components
# We'll extract the key functions from your notebook

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"])

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables for your system
openai_api_key = os.getenv("OPEN_AI_KEY")
phoenix_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT")
openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Database connection
DB_PATH = "insurance_support.db"
PORT = int(os.getenv("PORT") or "8002")

_faq_ready = False
_faq_error = None
_faq_vectorizer = None
_faq_question_matrix = None
_faq_questions = None
_faq_answers = None
_faq_min_score = float(os.getenv("FAQ_MIN_SCORE", "0.15"))
_faq_backend = "tfidf"
_faq_chroma_collection = None
_faq_chroma_path = os.getenv("CHROMA_PATH", "./chroma_db")
_faq_chroma_collection_name = os.getenv("CHROMA_COLLECTION", "insurance_FAQ_collection")
_faq_retriever_mode = os.getenv("FAQ_RETRIEVER", "auto").strip().lower()
_session_state: Dict[str, Dict[str, Any]] = {}

def _get_session_state(session_id: Optional[str]) -> Dict[str, Any]:
    if not session_id:
        return {}
    s = _session_state.get(session_id)
    if not s:
        s = {
            "pending": None,
            "intent": None,
            "pending_query": None,
            "customer_id": None,
            "policy_number": None,
            "turns": 0,
            "failures": 0,
            "last_agent": None,
            "escalated": False,
            "updated_at": time.time(),
        }
        _session_state[session_id] = s
    return s

def _set_session_state(session_id: Optional[str], **updates):
    if not session_id:
        return
    s = _get_session_state(session_id)
    s.update(updates)
    s["updated_at"] = time.time()

def _clear_session_pending(session_id: Optional[str]):
    _set_session_state(session_id, pending=None, intent=None, pending_query=None)

def _extract_policy_number(text: str) -> Optional[str]:
    m = re.search(r"\bPOL\d+\b", str(text or ""), flags=re.IGNORECASE)
    return m.group(0).upper() if m else None

def _extract_claim_id(text: str) -> Optional[str]:
    m = re.search(r"\bCLM\d+\b", str(text or ""), flags=re.IGNORECASE)
    return m.group(0).upper() if m else None

def _analyze_sentiment(text: str) -> float:
    """Analyze sentiment of text using TextBlob. Returns polarity (-1.0 to 1.0)"""
    try:
        blob = TextBlob(str(text or ""))
        return blob.sentiment.polarity
    except Exception as e:
        logger.warning(f"Sentiment analysis failed: {e}")
        return 0.0

def _should_escalate(user_query: str, session: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    q = str(user_query or "").lower()
    
    # 1. Keyword-based escalation
    if any(w in q for w in ["human", "representative", "real agent", "call me", "phone call", "speak to someone"]):
        return {"reason": "User requested a human representative", "priority": "high"}
    if any(w in q for w in ["complaint", "lawsuit", "legal", "fraud", "police", "cancel policy now"]):
        return {"reason": "Sensitive request requiring human handling", "priority": "high"}
    
    # 2. Sentiment-based escalation
    sentiment_score = _analyze_sentiment(user_query)
    if sentiment_score < -0.3:  # Negative sentiment threshold
        logger.info(f"😠 Negative sentiment detected: {sentiment_score}")
        return {"reason": "Negative sentiment detected", "priority": "high", "sentiment_score": sentiment_score}

    # 3. Session-based escalation (failures)
    if session and int(session.get("failures") or 0) >= 3:
        return {"reason": "Multiple unsuccessful attempts in this session", "priority": "medium"}
    
    return None

def _detect_policy_type_hint(text: str) -> Optional[str]:
    q = str(text or "").lower()
    if any(w in q for w in ["auto", "car", "vehicle"]):
        return "auto"
    if any(w in q for w in ["home", "house", "property", "homeowners"]):
        return "home"
    if "life" in q:
        return "life"
    if any(w in q for w in ["health", "medical", "medicare", "medicaid"]):
        return "health"
    if any(w in q for w in ["travel"]):
        return "travel"
    return None

def _clean_faq_text(text: str) -> str:
    t = str(text or "")
    t = t.replace("-LRB-", "(").replace("-RRB-", ")")
    t = t.replace(" -LRB- ", " (").replace(" -RRB- ", ") ")
    t = re.sub(r"\s+", " ", t).strip()
    return t

def _filter_faq_matches_by_hint(user_query: str, matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    hint = _detect_policy_type_hint(user_query)
    if not hint:
        return matches
    keep = []
    for m in matches or []:
        blob = f"{m.get('question','')} {m.get('answer','')}".lower()
        if hint in blob:
            keep.append(m)
    return keep

def _general_policy_overview(policy_type: str) -> Optional[str]:
    t = str(policy_type or "").strip().lower()
    if not t:
        return None
    prompt = (
        f"Give a helpful, accurate overview of {t} insurance. "
        "Explain what it covers, common exclusions, how premiums are calculated, and what information is needed to quote or look up a premium. "
        "Keep it concise and structured."
    )
    return _answer_general_chatgpt_style(prompt)

def _format_faq_answer(user_query: str, answer: str) -> str:
    a = _clean_faq_text(answer)
    q = str(user_query or "").strip()
    if not a:
        return ""
    if "\n" in a or a.startswith("#"):
        return a
    title = q if q else "Answer"
    return f"## {title}\n\n{a}"

def _pick_policy_for_customer(user_query: str, customer_id: str) -> Dict[str, Any]:
    policies = get_customer_policies(customer_id)
    if not policies:
        return {"policy_number": None, "policies": [], "error": "no_policies"}

    explicit = _extract_policy_number(user_query)
    if explicit:
        return {"policy_number": explicit, "policies": policies, "error": None}

    hint = _detect_policy_type_hint(user_query)
    if hint:
        matches = [p for p in policies if str(p.get("policy_type", "")).lower() == hint]
        if len(matches) == 1:
            return {"policy_number": matches[0]["policy_number"], "policies": policies, "error": None}
        if len(matches) > 1:
            return {"policy_number": None, "policies": matches, "error": "ambiguous_policy"}
        return {"policy_number": None, "policies": policies, "error": "policy_type_not_found", "hint": hint}

    def sort_key(p):
        status = str(p.get("status", "")).lower()
        start = str(p.get("start_date", "") or "")
        active_score = 1 if status == "active" else 0
        return (active_score, start)

    best = sorted(policies, key=sort_key, reverse=True)[0]
    return {"policy_number": best.get("policy_number"), "policies": policies, "error": None}

def _answer_general_chatgpt_style(user_query: str, system_role: str = None, image_data: str = None) -> Optional[str]:
    if not openai_api_key:
        return None
    
    default_system_role = (
        "You are an expert Insurance AI Assistant. "
        "Your ONLY purpose is to assist with insurance-related inquiries (policies, claims, billing, coverage, terminology). "
        "If the user asks about insurance, provide a helpful, professional, and concise answer. "
        "If the user asks about anything else (e.g., math, coding, life advice, cooking), politely decline and state that you can only help with insurance matters. "
        "Use Markdown for formatting (headings, bullet points) to make the response easy to read."
    )

    try:
        messages = [
            {
                "role": "system",
                "content": system_role or default_system_role,
            }
        ]

        if image_data:
            # Multi-modal message with image
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": str(user_query or "Please analyze this image.")},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_data  # Should be a base64 data URL
                        }
                    }
                ]
            })
        else:
            # Standard text message
            messages.append({"role": "user", "content": str(user_query or "")})

        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": openai_model,
                "temperature": 0.3,
                "messages": messages,
            },
            timeout=60, # Increased timeout for vision
        )
        resp.raise_for_status()
        data = resp.json()
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        content = str(msg.get("content") or "").strip()
        return content or None
    except Exception as e:
        logger.error(f"OpenAI API error: {e}")
        return None

def _build_faq_index_async():
    global _faq_ready, _faq_error, _faq_vectorizer, _faq_question_matrix, _faq_questions, _faq_answers, _faq_backend, _faq_chroma_collection
    try:
        if _faq_retriever_mode in {"auto", "chroma"}:
            try:
                import chromadb

                chroma_client = chromadb.PersistentClient(path=_faq_chroma_path)
                collection = chroma_client.get_or_create_collection(name=_faq_chroma_collection_name)
                if collection.count() > 0:
                    _faq_chroma_collection = collection
                    _faq_backend = "chroma"
                    _faq_ready = True
                    _faq_error = None
                    logger.info(f"✅ FAQ index ready via ChromaDB ({collection.count()} docs) at {_faq_chroma_path}/{_faq_chroma_collection_name}")
                    if _faq_retriever_mode == "chroma":
                        return
                else:
                    logger.warning("⚠️ Chroma collection exists but is empty; falling back to TF-IDF FAQ index")
            except Exception as e:
                if _faq_retriever_mode == "chroma":
                    raise
                logger.warning(f"⚠️ ChromaDB init failed; falling back to TF-IDF FAQ index: {e}")

        logger.info("📚 Loading FAQ dataset: deccan-ai/insuranceQA-v2")
        from datasets import load_dataset

        ds = load_dataset("deccan-ai/insuranceQA-v2", split="train")
        questions = []
        answers = []
        for row in ds:
            q = str(row.get("input", "")).strip()
            a = str(row.get("output", "")).strip()
            if q and a:
                questions.append(q)
                answers.append(a)

        if not questions:
            raise RuntimeError("FAQ dataset loaded but contains no usable Q/A rows")

        vectorizer = TfidfVectorizer(stop_words="english", max_features=60000)
        question_matrix = vectorizer.fit_transform(questions)

        _faq_vectorizer = vectorizer
        _faq_question_matrix = question_matrix
        _faq_questions = questions
        _faq_answers = answers
        _faq_ready = True
        if _faq_backend != "chroma":
            _faq_backend = "tfidf"
        _faq_error = None
        logger.info(f"✅ FAQ index ready ({len(questions)} Q/A pairs)")
    except Exception as e:
        _faq_error = str(e)
        _faq_ready = False
        logger.exception("❌ Failed to build FAQ index")

def _retrieve_faq(query: str, top_k: int = 3):
    if not _faq_ready:
        return []

    q = str(query or "").strip()
    if not q:
        return []

    if _faq_backend == "chroma" and _faq_chroma_collection is not None:
        top_k = max(1, min(int(top_k), 5))
        try:
            res = _faq_chroma_collection.query(
                query_texts=[q],
                n_results=top_k,
                include=["metadatas", "documents", "distances"],
            )
        except Exception:
            return []

        metadatas = (res.get("metadatas") or [[]])[0] or []
        documents = (res.get("documents") or [[]])[0] or []
        distances = (res.get("distances") or [[]])[0] or []
        out = []
        for i in range(min(len(documents), len(metadatas) or len(documents))):
            md = metadatas[i] if i < len(metadatas) else {}
            doc = documents[i] if i < len(documents) else ""
            dist = distances[i] if i < len(distances) else None
            score = (1.0 / (1.0 + float(dist))) if dist is not None else 1.0
            answer = md.get("answer") if isinstance(md, dict) else None
            question = md.get("question") if isinstance(md, dict) else None
            if not answer and isinstance(doc, str):
                answer = doc
            if not question and isinstance(doc, str) and doc.lower().startswith("question:"):
                question = doc.split("\n", 1)[0].replace("Question:", "").strip()
            out.append(
                {
                    "question": question or "",
                    "answer": answer or "",
                    "score": score,
                    "distance": float(dist) if dist is not None else None,
                    "source": f"chroma:{_faq_chroma_collection_name}",
                }
            )
        if out and float(out[0].get("score") or 0) >= _faq_min_score:
            return out

    if not _faq_vectorizer or _faq_question_matrix is None:
        return []

    query_vec = _faq_vectorizer.transform([q])
    sims = cosine_similarity(query_vec, _faq_question_matrix).flatten()
    if sims.size == 0:
        return []

    top_k = max(1, min(int(top_k), 5))
    idxs = np.argpartition(-sims, top_k - 1)[:top_k]
    idxs = idxs[np.argsort(-sims[idxs])]

    if float(sims[int(idxs[0])]) < _faq_min_score:
        return []

    out = []
    for idx in idxs:
        out.append({
            "question": _faq_questions[int(idx)],
            "answer": _faq_answers[int(idx)],
            "score": float(sims[int(idx)]),
            "source": "deccan-ai/insuranceQA-v2",
        })
    return out

def get_db_connection():
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_policy_details(policy_number: str, customer_id: str = None) -> Dict[str, Any]:
    """Fetch a customer's policy details by policy number"""
    logger.info(f"🔍 Fetching policy details for: {policy_number}")
    conn = get_db_connection()
    cursor = conn.cursor()
    if customer_id:
        cursor.execute("""
        SELECT p.*, c.first_name, c.last_name 
        FROM policies p 
        JOIN customers c ON p.customer_id = c.customer_id 
        WHERE p.policy_number = ? AND p.customer_id = ?
    """, (policy_number, customer_id))
    else:
        cursor.execute("""
        SELECT p.*, c.first_name, c.last_name 
        FROM policies p 
        JOIN customers c ON p.customer_id = c.customer_id 
        WHERE p.policy_number = ?
    """, (policy_number,))
    result = cursor.fetchone()
    
    if result:
        logger.info(f"✅ Policy found: {policy_number}")
        policy_data = dict(result)
        
        # Fetch additional details based on policy type
        policy_type = str(policy_data.get('policy_type', '')).lower()
        
        if policy_type == 'auto':
            cursor.execute("""
                SELECT vehicle_make, vehicle_model, vehicle_year, vehicle_vin
                FROM auto_policy_details
                WHERE policy_number = ?
            """, (policy_number,))
            auto_details = cursor.fetchone()
            if auto_details:
                policy_data.update(dict(auto_details))
                
        elif policy_type == 'life':
            cursor.execute("""
                SELECT age, gender, smoker, coverage_amount, term_length
                FROM life_policy_details
                WHERE policy_number = ?
            """, (policy_number,))
            life_details = cursor.fetchone()
            if life_details:
                policy_data.update(dict(life_details))
        
        conn.close()
        return policy_data
        
    conn.close()
    logger.warning(f"❌ Policy not found: {policy_number}")
    return {"error": "Policy not found"}

def get_claim_status(claim_id: str = None, policy_number: str = None, customer_id: str = None) -> Dict[str, Any]:
    """Get claim status and details"""
    logger.info(f"🔍 Fetching claim status - Claim ID: {claim_id}, Policy: {policy_number}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if claim_id:
        if customer_id:
            cursor.execute("""
            SELECT c.*, p.policy_type 
            FROM claims c
            JOIN policies p ON c.policy_number = p.policy_number
            WHERE c.claim_id = ? AND p.customer_id = ?
        """, (claim_id, customer_id))
        else:
            cursor.execute("""
            SELECT c.*, p.policy_type 
            FROM claims c
            JOIN policies p ON c.policy_number = p.policy_number
            WHERE c.claim_id = ?
        """, (claim_id,))
    elif policy_number:
        if customer_id:
            cursor.execute("""
            SELECT c.*, p.policy_type 
            FROM claims c
            JOIN policies p ON c.policy_number = p.policy_number
            WHERE c.policy_number = ? AND p.customer_id = ?
            ORDER BY c.claim_date DESC LIMIT 3
        """, (policy_number, customer_id))
        else:
            cursor.execute("""
            SELECT c.*, p.policy_type 
            FROM claims c
            JOIN policies p ON c.policy_number = p.policy_number
            WHERE c.policy_number = ?
            ORDER BY c.claim_date DESC LIMIT 3
        """, (policy_number,))
    
    result = cursor.fetchall()
    conn.close()
    
    if result:
        logger.info(f"✅ Found {len(result)} claim(s)")
        return [dict(row) for row in result]
    logger.warning("❌ No claims found")
    return {"error": "Claim not found"}

def get_billing_info(policy_number: str = None, customer_id: str = None) -> Dict[str, Any]:
    """Get billing information including current balance and due dates"""
    logger.info(f"🔍 Fetching billing info - Policy: {policy_number}, Customer: {customer_id}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if policy_number:
        if customer_id:
            cursor.execute("""
            SELECT b.*, p.premium_amount, p.billing_frequency
            FROM billing b
            JOIN policies p ON b.policy_number = p.policy_number
            WHERE b.policy_number = ? AND p.customer_id = ? AND b.status = 'pending'
            ORDER BY b.due_date DESC LIMIT 1
        """, (policy_number, customer_id))
        else:
            cursor.execute("""
            SELECT b.*, p.premium_amount, p.billing_frequency
            FROM billing b
            JOIN policies p ON b.policy_number = p.policy_number
            WHERE b.policy_number = ? AND b.status = 'pending'
            ORDER BY b.due_date DESC LIMIT 1
        """, (policy_number,))
    elif customer_id:
        cursor.execute("""
            SELECT b.*, p.premium_amount, p.billing_frequency
            FROM billing b
            JOIN policies p ON b.policy_number = p.policy_number
            WHERE p.customer_id = ? AND b.status = 'pending'
            ORDER BY b.due_date DESC LIMIT 1
        """, (customer_id,))
    
    result = cursor.fetchone()
    conn.close()
    
    if result:
        logger.info("✅ Billing info found")
        return dict(result)
    logger.warning("❌ Billing info not found")
    return {"error": "Billing information not found"}

def get_payment_history(policy_number: str, customer_id: str = None) -> List[Dict[str, Any]]:
    """Get payment history for a policy"""
    logger.info(f"🔍 Fetching payment history for policy: {policy_number}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if customer_id:
        cursor.execute("""
        SELECT p.payment_date, p.amount, p.status, p.payment_method
        FROM payments p
        JOIN billing b ON p.bill_id = b.bill_id
        JOIN policies pol ON b.policy_number = pol.policy_number
        WHERE b.policy_number = ? AND pol.customer_id = ?
        ORDER BY p.payment_date DESC LIMIT 10
    """, (policy_number, customer_id))
    else:
        cursor.execute("""
        SELECT p.payment_date, p.amount, p.status, p.payment_method
        FROM payments p
        JOIN billing b ON p.bill_id = b.bill_id
        WHERE b.policy_number = ?
        ORDER BY p.payment_date DESC LIMIT 10
    """, (policy_number,))
    
    result = cursor.fetchall()
    conn.close()
    
    if result:
        return [dict(row) for row in result]
    return []

def get_auto_policy_details(policy_number: str) -> Dict[str, Any]:
    """Get auto policy details"""
    logger.info(f"🔍 Fetching auto policy details for: {policy_number}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT p.*, ap.vehicle_make, ap.vehicle_model, ap.vehicle_year, ap.vin_number
        FROM policies p
        JOIN auto_policy_details ap ON p.policy_number = ap.policy_number
        WHERE p.policy_number = ?
    """, (policy_number,))
    
    result = cursor.fetchone()
    conn.close()
    
    if result:
        logger.info(f"✅ Auto policy found: {policy_number}")
        return dict(result)
    logger.warning(f"❌ Auto policy not found: {policy_number}")
    return {"error": "Auto policy not found"}

def get_customer_policies(customer_id: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT policy_number, policy_type, start_date, premium_amount, billing_frequency, status
        FROM policies
        WHERE customer_id = ?
        ORDER BY start_date DESC
    """, (customer_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_customer_claims(customer_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT c.*, p.policy_type
        FROM claims c
        JOIN policies p ON c.policy_number = p.policy_number
        WHERE p.customer_id = ?
        ORDER BY c.claim_date DESC
        LIMIT ?
    """, (customer_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_customer_bills(customer_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT b.*, p.premium_amount, p.billing_frequency
        FROM billing b
        JOIN policies p ON b.policy_number = p.policy_number
        WHERE p.customer_id = ?
        ORDER BY b.billing_date DESC
        LIMIT ?
    """, (customer_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def check_upcoming_bills(customer_id: str) -> List[Dict[str, Any]]:
    """Check for bills due within the next 7 days"""
    logger.info(f"🔔 Checking upcoming bills for: {customer_id}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Calculate date range (today to today + 7 days)
    today = datetime.now().strftime('%Y-%m-%d')
    next_week = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')
    
    cursor.execute("""
        SELECT b.*, p.policy_type
        FROM billing b
        JOIN policies p ON b.policy_number = p.policy_number
        WHERE p.customer_id = ? 
        AND b.status = 'pending'
        AND b.due_date BETWEEN ? AND ?
        ORDER BY b.due_date ASC
    """, (customer_id, today, next_week))
    
    rows = cursor.fetchall()
    conn.close()
    
    alerts = []
    for r in rows:
        row = dict(r)
        alerts.append({
            "type": "bill_due",
            "policy_number": row.get('policy_number'),
            "policy_type": row.get('policy_type'),
            "amount": row.get('amount_due'),
            "due_date": row.get('due_date'),
            "bill_id": row.get('bill_id'),
            "message": f"Hi! Just a reminder, your {row.get('policy_type')} policy premium of ${row.get('amount_due')} is due on {row.get('due_date')}. Want me to pay it?"
        })
    
    return alerts

# Semantic Intent Classification
def _classify_intent_with_llm(user_query: str, customer_id: str = None, policy_number: str = None) -> Dict[str, Any]:
    """
    Use LLM to classify user intent and extract entities.
    Returns: {
        "intent": "file_claim" | "check_claim_status" | "billing_inquiry" | "policy_details" | "general_inquiry" | "escalation",
        "confidence": float,
        "reasoning": str,
        "entities": { ... }
    }
    """
    if not openai_api_key:
        logger.warning("⚠️ OpenAI API key missing, falling back to keyword routing")
        return {"intent": "unknown", "confidence": 0.0}

    prompt = f"""
    You are the Router for an Insurance AI System. Your job is to classify the user's intent.
    
    User Query: "{user_query}"
    Context: CustomerID={customer_id}, PolicyNumber={policy_number}
    
    Available Intents:
    1. policy_details: Questions about coverage, deductibles, limits, benefits, or "what is my policy?".
    2. billing_inquiry: Questions about payments, premiums, due dates, invoices, or "pay my bill".
    3. check_claim_status: Questions about existing claims, status updates, or "is my claim paid?".
    4. file_claim: Intent to report a NEW accident, loss, damage, or theft.
    5. general_inquiry: General insurance questions (what is liability?, how does deductible work?) not specific to the user's account.
    6. escalation: User is angry, frustrated, threatens legal action, or explicitly asks for a human agent.
    
    Output JSON ONLY:
    {{
        "intent": "one_of_the_above",
        "confidence": 0.0_to_1.0,
        "reasoning": "brief explanation",
        "entities": {{
            "policy_type": "auto|home|life|null",
            "sentiment": "positive|neutral|negative|very_negative"
        }}
    }}
    """
    
    try:
        response_text = _answer_general_chatgpt_style(prompt, system_role="You are a JSON-outputting intent classifier.")
        if not response_text:
            return {"intent": "unknown", "confidence": 0.0}
            
        # Clean up code blocks if present
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()
            
        return json.loads(response_text)
    except Exception as e:
        logger.error(f"Intent classification failed: {e}")
        return {"intent": "unknown", "confidence": 0.0}

# Improved supervisor agent logic using Semantic Routing
def supervisor_agent_logic(user_query: str, customer_id: str = None, policy_number: str = None, conversation_history: str = "") -> Dict[str, Any]:
    """Smart supervisor logic to route to appropriate agent using LLM classification"""
    logger.info(f"🤖 Supervisor analyzing query: {user_query}")
    
    # 1. Try Semantic Routing first
    classification = _classify_intent_with_llm(user_query, customer_id, policy_number)
    intent = classification.get("intent")
    confidence = classification.get("confidence", 0.0)
    logger.info(f"🧠 Semantic Intent: {intent} (Confidence: {confidence})")
    
    if confidence > 0.6:
        if intent == "escalation":
             return {"next_agent": "human_escalation_agent", "department": "Customer Support", "confidence": 1.0, "reason": "semantic_escalation"}
        if intent == "policy_details":
             return {"next_agent": "policy_agent", "department": "Policy", "confidence": confidence, "reason": "semantic_policy"}
        if intent == "billing_inquiry":
             return {"next_agent": "billing_agent", "department": "Billing", "confidence": confidence, "reason": "semantic_billing"}
        if intent in ["check_claim_status", "file_claim"]:
             return {"next_agent": "claims_agent", "department": "Claims", "confidence": confidence, "reason": "semantic_claims"}
        if intent == "general_inquiry":
             return {"next_agent": "general_help_agent", "department": "General Help", "confidence": confidence, "reason": "semantic_general"}

    # 2. Fallback to Rule-Based (Keyword) Routing if Semantic fails or confidence is low
    logger.info("⚠️ Falling back to rule-based routing")
    query_lower = user_query.lower()
    has_account_context = bool(customer_id) or bool(policy_number)
    has_policy_hint = "pol" in query_lower
    has_claim_hint = "clm" in query_lower or "claim id" in query_lower

    acquisition_intent = any(w in query_lower for w in ["apply", "buy", "purchase", "quote", "get a quote", "enroll", "sign up", "new policy"])
    if acquisition_intent and any(w in query_lower for w in ["insurance", "policy", "coverage", "auto", "home", "life", "health", "travel"]):
        return {"next_agent": "general_help_agent", "department": "General Help", "confidence": 0.8, "reason": "acquisition_intent"}
    
    if any(word in query_lower for word in ['billing', 'payment', 'premium', 'invoice', 'charge', 'due']):
        if not has_account_context:
            return {"next_agent": "general_help_agent", "department": "General Help", "confidence": 0.7, "reason": "billing_no_account_context"}
        return {"next_agent": "billing_agent", "department": "Billing", "confidence": 0.85, "reason": "billing_keywords"}
    if any(word in query_lower for word in ['claim', 'accident', 'damage', 'incident', 'settlement']) or has_claim_hint:
        if not has_account_context and not has_claim_hint:
            return {"next_agent": "general_help_agent", "department": "General Help", "confidence": 0.7, "reason": "claims_no_account_context"}
        return {"next_agent": "claims_agent", "department": "Claims", "confidence": 0.85, "reason": "claims_keywords"}
    if any(word in query_lower for word in ['policy', 'coverage', 'insured', 'benefit', 'limit', 'rider', 'endorsement']) or has_policy_hint or bool(policy_number):
        if not has_account_context and not has_policy_hint:
            return {"next_agent": "general_help_agent", "department": "General Help", "confidence": 0.7, "reason": "policy_no_account_context"}
        return {"next_agent": "policy_agent", "department": "Policy", "confidence": 0.85, "reason": "policy_keywords"}
    return {"next_agent": "general_help_agent", "department": "General Help", "confidence": 0.6, "reason": "fallback"}

# Agent processing functions
def process_policy_query(user_query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Process policy-related queries"""
    logger.info("📄 Processing policy query")
    
    customer_id = context.get('customer_id')
    policy_number = context.get('policy_number')
    q = str(user_query or "").lower()
    acquisition_intent = any(w in q for w in ["apply", "buy", "purchase", "quote", "get a quote", "enroll", "sign up", "new policy"])
    if acquisition_intent:
        return process_general_help_query(user_query, context)

    # NEW: Check for "all policies" / "summary" intent BEFORE trying to pick a single policy
    list_keywords = [
        "what policies", "list", "show my policies", "my policies", "policies do i have", 
        "how many policies", "active policies", "detailed description", "tell me about my policies",
        "all policies", "all active policies", "summary of policies", "policy summary", "everything",
        "all my policies", "overview"
    ]
    if customer_id and any(w in q for w in list_keywords):
        logger.info(f"📋 Detected 'List All Policies' intent for customer {customer_id}")
        policies = get_customer_policies(customer_id)
        if policies:
            lines = []
            for p in policies:
                p_details = get_policy_details(p['policy_number'], customer_id)
                # Build a robust detail string for each policy
                detail_str = f"**{p['policy_number']}** ({p['policy_type']}, {p['status']})\n"
                detail_str += f"   - Premium: ${p['premium_amount']} {p['billing_frequency']}\n"
                detail_str += f"   - Start Date: {p['start_date']}\n"
                
                if p['policy_type'] == 'auto':
                    detail_str += f"   - Vehicle: {p_details.get('vehicle_year', '')} {p_details.get('vehicle_make', '')} {p_details.get('vehicle_model', '')}\n"
                    detail_str += f"   - VIN: {p_details.get('vehicle_vin', 'N/A')}\n"
                elif p['policy_type'] == 'life':
                    detail_str += f"   - Coverage: ${p_details.get('coverage_amount', 'N/A')}, Term: {p_details.get('term_length', 'N/A')} years\n"
                    detail_str += f"   - Beneficiary/Age: {p_details.get('age', 'N/A')} years old\n"
                
                lines.append(detail_str)
            
            prompt = (
                f"The user asked: '{user_query}'. "
                f"The customer has {len(policies)} policies. Here are the details:\n" + "\n".join(lines) + 
                "\nProvide a detailed summary of ALL these policies as requested. "
                "Do NOT focus on just one. Describe each one briefly."
            )
            llm_response = _answer_general_chatgpt_style(prompt)
            
            return {
                "response": llm_response or ("## Your Policies\n\n" + "\n".join(lines)),
                "agent": "policy_agent",
                "metadata": {"customer_id": customer_id, "policy_count": len(policies), "policies": policies, "llm": bool(llm_response)}
            }

    if not policy_number and customer_id:
        selection = _pick_policy_for_customer(user_query, customer_id)
        if selection.get("error") == "no_policies":
            return {
                "response": "I couldn't find any policies for your account.",
                "agent": "policy_agent",
                "metadata": {"customer_id": customer_id, "found": False}
            }

        if selection.get("error") == "ambiguous_policy":
            lines = []
            for p in selection.get("policies") or []:
                lines.append(f"{p.get('policy_number')} ({p.get('policy_type')}, {p.get('status')}, ${p.get('premium_amount')} {p.get('billing_frequency')})")
            return {
                "response": "## Which Policy Do You Mean?\n\nI found multiple matching policies. Please reply with the policy number:\n- " + "\n- ".join(lines),
                "agent": "policy_agent",
                "metadata": {"customer_id": customer_id, "found": True, "policy_count": len(selection.get("policies") or [])}
            }

        if selection.get("error") == "policy_type_not_found":
            lines = [f"{p.get('policy_number')} ({p.get('policy_type')}, {p.get('status')})" for p in (selection.get("policies") or [])]
            hint = selection.get("hint")
            overview = _general_policy_overview(hint)
            extra = f"\n\n## General {hint.title()} Insurance Overview\n\n{overview}" if overview else ""
            return {
                "response": "## Policy Availability\n\n"
                           f"I couldn't find any {hint} policies on your account.\n\n"
                           "## Policies on Your Account\n\n- " + "\n- ".join(lines) + "\n\n"
                           "## Next Step\n\nPlease reply with the policy number you want me to check." + extra,
                "agent": "policy_agent",
                "metadata": {"customer_id": customer_id, "found": False, "hint": hint, "available_policy_count": len(selection.get("policies") or [])}
            }

        policy_number = selection.get("policy_number")

    if not policy_number:
        policy_number = _extract_policy_number(user_query)

    if not policy_number:
        return {
            "response": "Please provide a policy number so I can look up the details.",
            "agent": "policy_agent",
            "metadata": {"found": False}
        }

    policy_details = get_policy_details(policy_number, customer_id=customer_id)
    
    if "error" in policy_details:
        msg = f"I couldn't find policy {policy_number} on your account." if customer_id else f"I couldn't find policy {policy_number} in the system."
        return {
            "response": f"{msg} Please check the policy number and try again.",
            "agent": "policy_agent",
            "metadata": {"policy_number": policy_number, "found": False}
        }
    
    # Generate response based on query
    q = user_query.lower()

    # Build context string from policy details
    details_context = (
        f"Type: {policy_details.get('policy_type', 'N/A')}\n"
        f"Status: {policy_details.get('status', 'N/A')}\n"
        f"Start date: {policy_details.get('start_date', 'N/A')}\n"
        f"Premium: ${policy_details.get('premium_amount', 'N/A')}\n"
        f"Billing frequency: {policy_details.get('billing_frequency', 'N/A')}\n"
    )

    if policy_details.get('policy_type') == 'auto':
        details_context += (
            f"Vehicle: {policy_details.get('vehicle_year', '')} {policy_details.get('vehicle_make', '')} {policy_details.get('vehicle_model', '')}\n"
            f"VIN: {policy_details.get('vehicle_vin', 'N/A')}\n"
        )
    elif policy_details.get('policy_type') == 'life':
        details_context += (
            f"Coverage Amount: ${policy_details.get('coverage_amount', 'N/A')}\n"
            f"Term Length: {policy_details.get('term_length', 'N/A')} years\n"
            f"Insured Age: {policy_details.get('age', 'N/A')}\n"
        )

    if any(w in q for w in ['complete', 'full', 'all details', 'details', 'information', 'info']):
        prompt = (
            f"Generate a helpful, friendly response for the customer {policy_details.get('first_name', '')} {policy_details.get('last_name', '')} "
            f"regarding their policy {policy_number}. "
            "Use the following details to answer:\n"
            f"{details_context}"
            "Format the response nicely with Markdown."
        )
        llm_response = _answer_general_chatgpt_style(prompt)
        
        response = llm_response or (
            f"Policy {policy_number} details:\n{details_context}"
            f"Customer: {policy_details.get('first_name', '')} {policy_details.get('last_name', '')}".strip()
        )
        return {
            "response": response,
            "agent": "policy_agent",
            "metadata": {"policy_number": policy_number, "found": True, "policy": policy_details, "llm": bool(llm_response)}
        }

    prompt = (
        f"The user asked: '{user_query}'. "
        f"Based on their policy {policy_number}, here are the details:\n"
        f"{details_context}"
        "Provide a helpful, natural language response answering their question using these details. "
        "Keep it professional but friendly."
    )
    llm_response = _answer_general_chatgpt_style(prompt)

    response = llm_response or f"I'll help you with your policy inquiry. Based on your policy {policy_number}, you have {policy_details.get('policy_type', 'auto')} coverage. "
    
    if not llm_response:
        if 'premium' in q:
            response += f"Your premium amount is ${policy_details.get('premium_amount', 'N/A')}. "
        
        if 'coverage' in q:
            response += "You have comprehensive coverage with standard deductibles. "
        
        response += "Would you like more specific details about your policy?"
    
    return {
        "response": response,
        "agent": "policy_agent",
        "metadata": {"policy_number": policy_number, "found": True, "policy_type": policy_details.get('policy_type'), "llm": bool(llm_response)}
    }

def process_billing_query(user_query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Process billing-related queries"""
    logger.info("💰 Processing billing query")
    
    customer_id = context.get('customer_id')
    policy_number = context.get('policy_number')
    billing_info = None

    if policy_number:
        billing_info = get_billing_info(policy_number=policy_number, customer_id=customer_id)
    elif customer_id:
        billing_info = get_billing_info(customer_id=customer_id)
    
    if not billing_info or (isinstance(billing_info, dict) and "error" in billing_info):
        if policy_number:
            policy = get_policy_details(policy_number, customer_id=customer_id)
            if isinstance(policy, dict) and "error" not in policy:
                prompt = (
                    f"The user asked: '{user_query}'. "
                    f"Inform the customer that there are no pending invoices for policy {policy_number}. "
                    f"Mention their current premium is ${policy.get('premium_amount', 'N/A')} {policy.get('billing_frequency', 'monthly')}. "
                    "Offer to help them generate an invoice or set up autopay. Keep it helpful."
                )
                llm_response = _answer_general_chatgpt_style(prompt)
                
                response = llm_response or (
                    "I'll help you with your billing question. "
                    f"Your current premium is ${policy.get('premium_amount', 'N/A')} {policy.get('billing_frequency', 'monthly')}. "
                    "I don't see any pending invoices for this policy yet. "
                    "Would you like me to generate an invoice or set up automatic payments?"
                )
                return {
                    "response": response,
                    "agent": "billing_agent",
                    "metadata": {"policy_number": policy_number, "customer_id": customer_id, "found": True, "invoices": 0, "llm": bool(llm_response)}
                }
        return {
            "response": "I couldn't find billing information for your account. Please verify your policy number or try again.",
            "agent": "billing_agent",
            "metadata": {"policy_number": policy_number, "customer_id": customer_id, "found": False}
        }
    
    # Generate response based on query
    prompt = (
        f"The user asked: '{user_query}'. "
        f"Billing Info found: Next payment of ${billing_info.get('amount_due', 'N/A')} is due on {billing_info.get('due_date', 'N/A')}. "
        f"Premium: ${billing_info.get('premium_amount', 'N/A')} {billing_info.get('billing_frequency', 'annually')}. "
        "Answer the user's question naturally using this data. Do not mention internal fields like 'billing_frequency' unless relevant."
    )
    
    if 'history' in user_query.lower() and policy_number:
        payment_history = get_payment_history(policy_number, customer_id=customer_id)
        if payment_history:
            last_pay = payment_history[0]
            prompt += (
                f" Also mention their last payment was ${last_pay.get('amount', 'N/A')} "
                f"on {last_pay.get('payment_date', 'N/A')}."
            )
            
    llm_response = _answer_general_chatgpt_style(prompt)
    
    response = llm_response or f"I'll help you with your billing question. Your next payment of ${billing_info.get('amount_due', 'N/A')} is due on {billing_info.get('due_date', 'N/A')}."
    
    return {
        "response": response,
        "agent": "billing_agent",
        "metadata": {"policy_number": policy_number, "found": True, "billing_frequency": billing_info.get('billing_frequency'), "llm": bool(llm_response)}
    }

def process_claims_query(user_query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Process claims-related queries"""
    logger.info("📋 Processing claims query")
    
    customer_id = context.get('customer_id')
    policy_number = context.get('policy_number')
    claim_id = _extract_claim_id(user_query)

    if claim_id:
        claims = get_claim_status(claim_id=claim_id, customer_id=customer_id)
    elif policy_number:
        claims = get_claim_status(policy_number=policy_number, customer_id=customer_id)
    elif customer_id:
        claims = get_customer_claims(customer_id, limit=10)
    else:
        claims = {"error": "Claim not found"}
    
    if isinstance(claims, dict) and "error" in claims:
        return {
            "response": "I couldn't find any claims for your account. If you have a specific claim ID or policy number, please provide it.",
            "agent": "claims_agent",
            "metadata": {"policy_number": policy_number, "customer_id": customer_id, "found": False}
        }
    
    # Generate response based on query
    if len(claims) > 0:
        latest_claim = claims[0]
        prompt = (
            f"The user asked: '{user_query}'. "
            f"Here is the latest claim info: "
            f"Claim ID: {latest_claim.get('claim_id')}, "
            f"Date: {latest_claim.get('claim_date')}, "
            f"Type: {latest_claim.get('incident_type')}, "
            f"Loss: ${latest_claim.get('estimated_loss', 'N/A')}, "
            f"Status: {latest_claim.get('status')}. "
            f"Total claims found: {len(claims)}. "
            "Provide a natural language summary of this claim status for the customer."
        )
        llm_response = _answer_general_chatgpt_style(prompt)
        
        response = llm_response or (
            f"I can see you have {len(claims)} claim(s). Your most recent claim ({latest_claim.get('claim_id')}) from {latest_claim.get('claim_date')} "
            f"regarding {latest_claim.get('incident_type')} has an estimated loss of ${latest_claim.get('estimated_loss', 'N/A')} "
            f"and is currently {latest_claim.get('status')}."
        )
    else:
        response = "I couldn't find any claims on file."

    if "filing a new claim" not in response and "status" not in response:
        response += " Would you like an update on the status or help with filing a new claim?"
    
    return {
        "response": response,
        "agent": "claims_agent",
        "metadata": {"policy_number": policy_number, "claim_id": claim_id, "found": True, "claim_count": len(claims), "llm": bool(llm_response if len(claims)>0 else False)}
    }

def process_general_help_query(user_query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Process general insurance help queries"""
    logger.info("❓ Processing general help query")
    
    if not _faq_ready:
        waited = 0.0
        while waited < 8.0 and not _faq_ready:
            time.sleep(0.5)
            waited += 0.5

        if not _faq_ready:
            return {
                "response": "The insurance FAQ knowledge base is still loading. Please try again in a few seconds.",
                "agent": "general_help_agent",
                "metadata": {"query_type": "faq", "ready": False, "error": _faq_error}
            }

    q = user_query.lower()
    insurance_keywords = ['insurance', 'policy', 'coverage', 'claim', 'premium', 'deductible', 'copay', 'coinsurance', 'billing', 'benefit']
    if not any(k in q for k in insurance_keywords):
        llm = _answer_general_chatgpt_style(user_query)
        return {
            "response": llm or "I can help with insurance questions (policies, claims, billing, and FAQs). Please ask an insurance-related question.",
            "agent": "general_help_agent",
            "metadata": {"query_type": "non_insurance", "llm": bool(llm)}
        }

    matches = _retrieve_faq(user_query, top_k=3)
    matches = _filter_faq_matches_by_hint(user_query, matches)
    if not matches:
        llm = _answer_general_chatgpt_style(
            "Answer the following insurance question in a professional, structured format with headings.\n\n"
            f"Question: {user_query}"
        )
        response = llm or (
            "## No Exact FAQ Match\n\n"
            "I couldn't find an exact match in the insurance FAQ knowledge base.\n\n"
            "## How to Proceed\n\n"
            "- Rephrase your question using different wording\n"
            "- Ask about a specific policy number, billing question, or claim"
        )
        return {
            "response": response,
            "agent": "general_help_agent",
            "metadata": {"query_type": "faq", "matches": 0, "llm": bool(llm)}
        }

    # Use RAG with OpenAI to generate a synthesized response
    context_text = ""
    for i, m in enumerate(matches[:3]):
        context_text += f"Context {i+1}:\nQ: {m['question']}\nA: {m['answer']}\n\n"

    prompt = (
        "You are a helpful insurance assistant. Use the following context to answer the user's question.\n"
        "If the context doesn't fully answer the question, you can supplement with general knowledge, "
        "but prioritize the provided context.\n\n"
        f"{context_text}"
        f"User Question: {user_query}"
    )

    llm_response = _answer_general_chatgpt_style(prompt)

    if llm_response:
        return {
            "response": llm_response,
            "agent": "general_help_agent",
            "metadata": {"query_type": "faq", "matches": matches, "llm_rag": True}
        }

    # Fallback to direct FAQ answer if OpenAI fails
    best = matches[0]
    response = _format_faq_answer(user_query, best["answer"])
    
    return {
        "response": response,
        "agent": "general_help_agent",
        "metadata": {"query_type": "faq", "matches": matches, "llm_rag": False}
    }

# Main processing function
def process_insurance_query(user_query: str, customer_id: str = None, policy_number: str = None, 
                          conversation_history: str = "", session_id: str = None) -> Dict[str, Any]:
    """Main function to process insurance queries"""
    logger.info(f"🚀 Processing insurance query: {user_query}")

    session = _get_session_state(session_id)
    if session_id:
        session["turns"] = int(session.get("turns") or 0) + 1
        if customer_id:
            session["customer_id"] = customer_id
        if policy_number:
            session["policy_number"] = policy_number
        if not customer_id and session.get("customer_id"):
            customer_id = session.get("customer_id")
        if not policy_number and session.get("policy_number"):
            policy_number = session.get("policy_number")

        escalation = _should_escalate(user_query, session)
        if escalation and not session.get("escalated"):
            session["escalated"] = True
            return {
                "response": "I understand. Let me transfer you to a human representative for further assistance.",
                "agent": "human_escalation_agent",
                "status": "escalated",
                "next_agent": "human_escalation_agent",
                "confidence": 1.0,
                "metadata": {"type": "escalation", **escalation}
            }

    pn_in_text = _extract_policy_number(user_query)
    if pn_in_text:
        policy_number = pn_in_text
        if session_id:
            session["policy_number"] = policy_number

    if session_id and session.get("pending") == "policy_number":
        if policy_number:
            effective_query = session.get("pending_query") or user_query
            _clear_session_pending(session_id)
            user_query = effective_query
        else:
            return {
                "response": "Could you please provide your policy number? (example: POL000004)",
                "agent": "supervisor_agent",
                "status": "needs_input",
                "next_agent": "supervisor_agent",
                "confidence": 0.9,
                "metadata": {"pending": "policy_number"}
            }
    
    # Create context
    context = {
        "customer_id": customer_id,
        "policy_number": policy_number,
        "conversation_history": conversation_history
    }

    q = str(user_query or "").lower()
    is_premium_question = "premium" in q and not any(w in q for w in ["due", "payment", "invoice", "charge", "bill"])
    needs_policy_for_claims = any(w in q for w in ["claim", "accident", "damage", "incident", "status"]) and not _extract_claim_id(user_query)
    needs_policy_for_billing = any(w in q for w in ["billing", "bill", "invoice", "payment", "due", "history", "premium"])
    if (is_premium_question or needs_policy_for_claims or needs_policy_for_billing) and customer_id and not policy_number:
        selection = _pick_policy_for_customer(user_query, customer_id)
        if selection.get("error") == "ambiguous_policy":
            intent = "premium" if is_premium_question else ("claims" if needs_policy_for_claims else "billing")
            _set_session_state(session_id, pending="policy_number", intent=intent, pending_query=user_query, customer_id=customer_id)
            lines = [f"{p.get('policy_number')} ({p.get('policy_type')}, {p.get('status')})" for p in (selection.get("policies") or [])]
            return {
                "response": "## Which Policy Do You Mean?\n\nPlease reply with the policy number:\n- " + "\n- ".join(lines),
                "agent": "supervisor_agent",
                "status": "needs_input",
                "next_agent": "supervisor_agent",
                "confidence": 0.8,
                "metadata": {"pending": "policy_number", "intent": intent}
            }
        if selection.get("error") == "policy_type_not_found":
            intent = "premium" if is_premium_question else ("claims" if needs_policy_for_claims else "billing")
            _set_session_state(session_id, pending="policy_number", intent=intent, pending_query=user_query, customer_id=customer_id)
            lines = [f"{p.get('policy_number')} ({p.get('policy_type')}, {p.get('status')})" for p in (selection.get("policies") or [])]
            hint = selection.get("hint")
            overview = _general_policy_overview(hint)
            extra = f"\n\n## General {hint.title()} Insurance Overview\n\n{overview}" if overview else ""
            return {
                "response": "## Policy Availability\n\n"
                           f"I couldn't find any {hint} policies on your account.\n\n"
                           "## Policies on Your Account\n\n- " + "\n- ".join(lines) + "\n\n"
                           "## Next Step\n\nPlease reply with the policy number you want me to check." + extra,
                "agent": "supervisor_agent",
                "status": "needs_input",
                "next_agent": "supervisor_agent",
                "confidence": 0.75,
                "metadata": {"pending": "policy_number", "intent": intent, "hint": hint}
            }
        policy_number = selection.get("policy_number")
        context["policy_number"] = policy_number
    
    # Route to appropriate agent
    routing = supervisor_agent_logic(user_query, customer_id, policy_number, conversation_history)
    next_agent = routing["next_agent"]
    
    logger.info(f"🎯 Routing to agent: {next_agent}")
    
    # Process with appropriate agent
    if next_agent == "policy_agent":
        result = process_policy_query(user_query, context)
    elif next_agent == "billing_agent":
        result = process_billing_query(user_query, context)
    elif next_agent == "claims_agent":
        result = process_claims_query(user_query, context)
    else:
        result = process_general_help_query(user_query, context)

    prev_agent = session.get("last_agent") if session_id else None
    if session_id:
        session["last_agent"] = result.get("agent")
        found = (result.get("metadata") or {}).get("found")
        if found is False:
            session["failures"] = int(session.get("failures") or 0) + 1
        elif found is True:
            session["failures"] = 0

    department = routing.get("department")
    if department and prev_agent and prev_agent != result.get("agent") and result.get("agent") in {"policy_agent", "billing_agent", "claims_agent"}:
        result["response"] = f"Let me transfer you to the {department} department.\n\n{result.get('response')}"

    result.setdefault("status", "completed")
    result.setdefault("next_agent", next_agent)
    result.setdefault("confidence", routing.get("confidence", 0.7))
    result.setdefault("metadata", {})
    result["metadata"] = {**(result.get("metadata") or {}), "routing": routing}
    return result

# API Routes
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "insurance-multi-agent-system",
        "version": "1.0.0",
        "faq_ready": _faq_ready,
        "faq_backend": _faq_backend,
        "faq_error": _faq_error
    })

@app.route('/api/process-query', methods=['POST'])
def process_query():
    """Main endpoint to process insurance queries"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        user_query = data.get('query', '')
        image_data = data.get('image') # Get base64 image data
        
        if not user_query and not image_data:
             return jsonify({"error": "Query text or image is required"}), 400

        customer_id = data.get('customer_id')
        policy_number = data.get('policy_number')
        conversation_history = data.get('conversation_history', '')
        session_id = data.get('session_id') or data.get('sessionId')
        
        logger.info(f"📨 Received query: '{user_query}' (Image attached: {bool(image_data)})")
        
        # If image is present, bypass standard routing and go straight to Vision processing
        if image_data:
            logger.info("🖼️ Image detected, using Vision capability")
            vision_response = _answer_general_chatgpt_style(
                user_query=user_query,
                system_role="You are an expert insurance adjuster AI. Analyze the uploaded image and the user's question. Identify vehicle damage, document types, or property issues. Be professional and helpful.",
                image_data=image_data
            )
            
            result = {
                "response": vision_response or "I received your image but couldn't analyze it. Please try again.",
                "agent": "vision_agent",
                "status": "completed",
                "confidence": 1.0,
                "metadata": {"has_image": True}
            }
        else:
            # Standard text processing
            result = process_insurance_query(
                user_query=user_query,
                customer_id=customer_id,
                policy_number=policy_number,
                conversation_history=conversation_history,
                session_id=session_id
            )
        
        logger.info(f"✅ Query processed successfully by {result['agent']}")
        
        return jsonify({
            "success": True,
            "data": {
                "response": result['response'],
                "agent": result['agent'],
                "next_agent": result.get('next_agent'),
                "status": result.get('status', 'completed'),
                "confidence": result.get('confidence'),
                "metadata": result['metadata'],
                "timestamp": datetime.now().isoformat()
            }
        })
        
    except Exception as e:
        logger.error(f"❌ Error processing query: {str(e)}", exc_info=True)
        # Return a friendly error response instead of 500 to keep the chat alive
        return jsonify({
            "success": True,
            "data": {
                "response": "I apologize, but I encountered an internal error while processing your request. Please try asking again in a moment.",
                "agent": "system_error",
                "status": "error",
                "metadata": {"error": str(e)}
            }
        })

@app.route('/api/agent-status', methods=['GET'])
def agent_status():
    """Get status of all agents"""
    return jsonify({
        "agents": {
            "supervisor_agent": {"status": "active", "last_used": datetime.now().isoformat()},
            "policy_agent": {"status": "active", "last_used": datetime.now().isoformat()},
            "billing_agent": {"status": "active", "last_used": datetime.now().isoformat()},
            "claims_agent": {"status": "active", "last_used": datetime.now().isoformat()},
            "general_help_agent": {"status": "active", "last_used": datetime.now().isoformat()}
        },
        "database_connected": os.path.exists(DB_PATH),
        "timestamp": datetime.now().isoformat()
    })

@app.route('/api/policy/<policy_number>', methods=['GET'])
def get_policy(policy_number):
    """Get policy details"""
    try:
        policy_details = get_policy_details(policy_number)
        if "error" in policy_details:
            return jsonify({"success": False, "error": policy_details["error"]}), 404
        
        return jsonify({"success": True, "data": policy_details})
    except Exception as e:
        logger.error(f"❌ Error fetching policy: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/claims', methods=['GET'])
def get_claims():
    """Get claims"""
    try:
        claim_id = request.args.get('claim_id')
        policy_number = request.args.get('policy_number')
        
        claims = get_claim_status(claim_id, policy_number)
        if "error" in claims:
            return jsonify({"success": False, "error": claims["error"]}), 404
        
        return jsonify({"success": True, "data": claims})
    except Exception as e:
        logger.error(f"❌ Error fetching claims: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/billing', methods=['GET'])
def get_billing():
    """Get billing information"""
    try:
        policy_number = request.args.get('policy_number')
        customer_id = request.args.get('customer_id')
        
        if not policy_number and not customer_id:
            return jsonify({"success": False, "error": "Policy number or customer ID required"}), 400
        
        billing_info = get_billing_info(policy_number, customer_id)
        if "error" in billing_info:
            return jsonify({"success": False, "error": billing_info["error"]}), 404
        
        return jsonify({"success": True, "data": billing_info})
    except Exception as e:
        logger.error(f"❌ Error fetching billing: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/notifications/proactive', methods=['GET'])
def get_proactive_notifications():
    """Get proactive notifications for a customer"""
    try:
        customer_id = request.args.get('customer_id')
        if not customer_id:
            return jsonify({"success": False, "error": "Customer ID required"}), 400
            
        alerts = check_upcoming_bills(customer_id)
        return jsonify({"success": True, "data": alerts})
    except Exception as e:
        logger.error(f"❌ Error fetching notifications: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    logger.info("🚀 Starting Insurance Multi-Agent System API Server")
    logger.info(f"📊 Database path: {DB_PATH}")
    logger.info(f"🔑 OpenAI API key configured: {bool(openai_api_key)}")
    
    # Check if database exists
    if not os.path.exists(DB_PATH):
        logger.warning(f"⚠️ Database not found at {DB_PATH}. Please run the Jupyter notebook first.")
    
    threading.Thread(target=_build_faq_index_async, daemon=True).start()
    app.run(host='0.0.0.0', port=PORT, debug=False, use_reloader=False, threaded=True)
