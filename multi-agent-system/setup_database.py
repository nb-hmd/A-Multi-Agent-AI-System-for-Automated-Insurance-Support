import sqlite3
import random
from datetime import datetime, timedelta

# Create sample database
conn = sqlite3.connect('insurance_support.db')
cursor = conn.cursor()

# Create tables with real structure
cursor.execute('''
CREATE TABLE IF NOT EXISTS customers (
    customer_id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    date_of_birth TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS policies (
    policy_number TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    premium_amount REAL NOT NULL,
    billing_frequency TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS auto_policies (
    policy_number TEXT PRIMARY KEY,
    vehicle_make TEXT,
    vehicle_model TEXT,
    vehicle_year INTEGER,
    vin_number TEXT,
    coverage_type TEXT,
    deductible_amount REAL,
    FOREIGN KEY (policy_number) REFERENCES policies(policy_number)
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS claims (
    claim_id TEXT PRIMARY KEY,
    policy_number TEXT NOT NULL,
    claim_date TEXT NOT NULL,
    incident_date TEXT,
    incident_type TEXT,
    description TEXT,
    estimated_loss REAL,
    settlement_amount REAL,
    status TEXT NOT NULL,
    adjuster_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_number) REFERENCES policies(policy_number)
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS billing (
    bill_id TEXT PRIMARY KEY,
    policy_number TEXT NOT NULL,
    bill_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    amount_due REAL NOT NULL,
    status TEXT NOT NULL,
    late_fee REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_number) REFERENCES policies(policy_number)
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS payments (
    payment_id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    transaction_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES billing(bill_id)
)
''')

# Insert sample data
customers = [
    ('CUST001', 'John', 'Doe', 'john.doe@email.com', '555-1234', '123 Main St', 'Anytown', 'CA', '90210', '1980-01-15'),
    ('CUST002', 'Jane', 'Smith', 'jane.smith@email.com', '555-5678', '456 Oak Ave', 'Somewhere', 'TX', '75001', '1985-03-22'),
    ('CUST003', 'Robert', 'Johnson', 'robert.j@email.com', '555-9012', '789 Pine Rd', 'Elsewhere', 'NY', '10001', '1978-07-08'),
]

for customer in customers:
    cursor.execute('INSERT OR REPLACE INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', customer)

# Insert sample policies
policies = [
    ('POL001', 'CUST001', 'auto', '2024-01-01', '2025-01-01', 1200.00, 'monthly', 'active'),
    ('POL002', 'CUST002', 'auto', '2024-02-15', '2025-02-15', 950.00, 'monthly', 'active'),
    ('POL003', 'CUST003', 'home', '2024-03-01', '2025-03-01', 800.00, 'annual', 'active'),
]

for policy in policies:
    cursor.execute('INSERT OR REPLACE INTO policies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', policy)

# Insert sample auto policy details
auto_policies = [
    ('POL001', 'Toyota', 'Camry', 2022, '1HGBH41JXMN109186', 'comprehensive', 500.00),
    ('POL002', 'Honda', 'Civic', 2021, '2HGES16591H901234', 'liability', 1000.00),
]

for auto_policy in auto_policies:
    cursor.execute('INSERT OR REPLACE INTO auto_policies VALUES (?, ?, ?, ?, ?, ?, ?)', auto_policy)

# Insert sample claims
claims = [
    ('CLM001', 'POL001', '2024-01-15', '2024-01-10', 'collision', 'Rear-end collision at intersection', 5000.00, 4500.00, 'settled'),
    ('CLM002', 'POL002', '2024-02-20', '2024-02-18', 'theft', 'Vehicle broken into, personal items stolen', 1500.00, 1200.00, 'settled'),
]

for claim in claims:
    cursor.execute('INSERT OR REPLACE INTO claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', claim)

# Insert sample billing
billing = [
    ('BILL001', 'POL001', '2024-01-01', '2024-01-15', 100.00, 'pending'),
    ('BILL002', 'POL002', '2024-02-01', '2024-02-15', 79.17, 'pending'),
]

for bill in billing:
    cursor.execute('INSERT OR REPLACE INTO billing VALUES (?, ?, ?, ?, ?, ?, ?)', bill)

# Insert sample payments
payments = [
    ('PAY001', 'BILL001', '2024-01-05', 100.00, 'credit_card', 'TXN123456', 'completed'),
    ('PAY002', 'BILL002', '2024-02-05', 79.17, 'bank_transfer', 'TXN789012', 'completed'),
]

for payment in payments:
    cursor.execute('INSERT OR REPLACE INTO payments VALUES (?, ?, ?, ?, ?, ?, ?, ?)', payment)

conn.commit()
conn.close()
print('✅ Sample database created with real data structure')
