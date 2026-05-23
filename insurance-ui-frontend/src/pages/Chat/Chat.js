import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Avatar,
  Chip,
  IconButton,
  Divider,
  CircularProgress,
  Alert,
  Fade,
  Badge,
} from '@mui/material';
import {
  Send as SendIcon,
  Person as PersonIcon,
  SmartToy as SmartToyIcon,
  Warning as WarningIcon,
  Phone as PhoneIcon,
  Schedule as ScheduleIcon,
  Mic as MicIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  VolumeUp as VolumeUpIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { useSettings } from '../../context/SettingsContext';
import ChatSidebar from './ChatSidebar';
import { useTheme, useMediaQuery, Drawer } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';

import dataService from '../../services/dataService';

const Chat = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const { settings, locale, timeZone } = useSettings();
  const {
    conversations,
    activeConversation,
    isTyping,
    typingUsers,
    loading,
    error,
    isConnected,
    sendMessage,
    addSystemMessage,
    startTyping,
    stopTyping,
    requestEscalation,
    createConversation,
    setActiveConversation,
  } = useChat();

  const [message, setMessage] = useState('');
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const notificationsChecked = useRef(false);
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    // Cleanup speech synthesis on unmount
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    // Initialize Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => {
        setIsListening(true);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setMessage((prev) => (prev ? prev + ' ' + transcript : transcript));
      };
      
      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };
    }
  }, []);

  const handleVoiceInput = () => {
    if (recognitionRef.current) {
      if (isListening) {
        recognitionRef.current.stop();
      } else {
        recognitionRef.current.start();
      }
    } else {
      showNotification('Speech recognition is not supported in this browser.', 'warning');
    }
  };

  // Create or get active conversation
  useEffect(() => {
    if (!activeConversation) {
      const sessionId = createConversation(user?.customerId, null);
      setActiveConversation(sessionId);
    }
  }, [activeConversation, user, createConversation, setActiveConversation]);

  // Check for Proactive Notifications
  useEffect(() => {
    const checkNotifications = async () => {
      if (user?.customerId && activeConversation && !notificationsChecked.current) {
        notificationsChecked.current = true; // Prevent double check
        try {
          const notifications = await dataService.getProactiveNotifications(user.customerId);
          if (notifications && notifications.length > 0) {
             notifications.forEach(note => {
               addSystemMessage(activeConversation, note.message, {
                 type: 'proactive_notification',
                 alertType: note.type,
                 billId: note.bill_id
               });
             });
          }
        } catch (err) {
          console.error("Failed to check notifications", err);
        }
      }
    };
    checkNotifications();
  }, [user, activeConversation, addSystemMessage]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (settings?.chat?.autoScroll !== false) {
      scrollToBottom();
    }
  }, [conversations, activeConversation]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSpeak = (text, messageId) => {
    if (isSpeaking && speakingMessageId === messageId) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel(); // Stop any current speech
    
    // Simple markdown stripping for better speech
    const cleanText = text
      .replace(/#{1,6}\s/g, '') // Remove headers
      .replace(/\*\*/g, '') // Remove bold
      .replace(/\*/g, '') // Remove italic
      .replace(/`/g, '') // Remove code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // clear links
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '') // clear images
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    };
    
    utterance.onerror = (e) => {
      console.error('Speech synthesis error', e);
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    };

    setSpeakingMessageId(messageId);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleTyping = (e) => {
    setMessage(e.target.value);
    
    if (!isTypingLocal) {
      setIsTypingLocal(true);
      startTyping(activeConversation);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout
    typingTimeoutRef.current = setTimeout(() => {
      setIsTypingLocal(false);
      stopTyping(activeConversation);
    }, 1000);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        showNotification('Image size should be less than 5MB', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if ((!message.trim() && !selectedImage) || !activeConversation) return;

    try {
      // If we have an image, we send it as part of the context or a special message type
      // For now, we'll assume the backend handles an 'image' field in the context
      const context = selectedImage ? { image: selectedImage } : {};
      
      const result = await sendMessage(activeConversation, message.trim(), context);
      if (result?.success) {
        setMessage('');
        setSelectedImage(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setIsTypingLocal(false);
        stopTyping(activeConversation);
      } else {
        showNotification(result?.error || 'Failed to send message. Please try again.', 'error');
      }
    } catch (error) {
      showNotification('Failed to send message. Please try again.', 'error');
    }
  };

  const handleEscalation = async () => {
    try {
      await requestEscalation(activeConversation, 'User requested human assistance', 'high');
      showNotification('Your request has been escalated to a human agent.', 'success');
    } catch (error) {
      showNotification('Failed to escalate. Please try again.', 'error');
    }
  };

  const currentConversation = conversations.get(activeConversation);
  const messages = currentConversation?.messages || [];
  const showTypingIndicator = settings?.chat?.showTypingIndicator !== false;

  const getMessageAvatar = (message) => {
    if (message.type === 'user') {
      return (
        <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
          <PersonIcon />
        </Avatar>
      );
    } else if (message.type === 'agent') {
      const agentType = message.metadata?.agentType || 'assistant';
      const agentColors = {
        supervisor_agent: '#1976d2',
        policy_agent: '#388e3c',
        billing_agent: '#f57c00',
        claims_agent: '#d32f2f',
        general_help_agent: '#7b1fa2',
        human_escalation_agent: '#5d4037',
        final_answer_agent: '#303f9f',
      };
      
      return (
        <Avatar sx={{ bgcolor: agentColors[agentType] || '#1976d2', width: 32, height: 32 }}>
          <SmartToyIcon />
        </Avatar>
      );
    } else if (message.type === 'system') {
      return (
        <Avatar sx={{ bgcolor: 'warning.main', width: 32, height: 32 }}>
          <WarningIcon />
        </Avatar>
      );
    }
    return null;
  };

  const getAgentLabel = (message) => {
    if (message.type === 'agent') {
      const agentType = message.metadata?.agentType || 'assistant';
      const agentNames = {
        supervisor_agent: 'Supervisor',
        policy_agent: 'Policy Agent',
        billing_agent: 'Billing Agent',
        claims_agent: 'Claims Agent',
        general_help_agent: 'Help Agent',
        human_escalation_agent: 'Human Agent',
        final_answer_agent: 'Final Answer',
      };
      return agentNames[agentType] || 'AI Assistant';
    }
    return null;
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Box sx={{ height: 'calc(100vh - 64px)', display: 'flex', overflow: 'hidden' }}>
      {/* Sidebar - Desktop (Collapsible) */}
      {!isMobile && (
        <Box
          sx={{
            width: sidebarOpen ? 280 : 0,
            transition: 'width 0.3s',
            overflow: 'hidden',
            borderRight: sidebarOpen ? 1 : 0,
            borderColor: 'divider',
          }}
        >
          <ChatSidebar />
        </Box>
      )}

      {/* Sidebar - Mobile */}
      <Drawer
        anchor="left"
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        sx={{ display: { xs: 'block', md: 'none' } }}
      >
        <ChatSidebar onClose={() => setMobileSidebarOpen(false)} />
      </Drawer>

      {/* Main Chat Area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Paper elevation={2} sx={{ p: 2, borderRadius: 0 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={2}>
              {isMobile ? (
                <IconButton onClick={() => setMobileSidebarOpen(true)}>
                  <MenuIcon />
                </IconButton>
              ) : (
                <IconButton onClick={() => setSidebarOpen(!sidebarOpen)}>
                  <MenuIcon />
                </IconButton>
              )}
              <Avatar sx={{ bgcolor: 'primary.main' }}>
                <SmartToyIcon />
              </Avatar>
            <Box>
              <Typography variant="h6" fontWeight="bold">
                Insurance AI Assistant
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {isConnected ? 'Online' : 'Connecting...'}
              </Typography>
            </Box>
          </Box>
          
          <Box display="flex" gap={1}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PhoneIcon />}
              onClick={handleEscalation}
              disabled={loading}
            >
              Human Agent
            </Button>
            <Chip
              label="AI Powered"
              color="primary"
              size="small"
              icon={<SmartToyIcon />}
            />
          </Box>
        </Box>
      </Paper>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}

      {/* Messages Area */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
          backgroundColor: 'background.default',
        }}
      >
        {messages.length === 0 && (
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%">
            <SmartToyIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              Welcome to Insurance AI Assistant
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center" maxWidth={400}>
              I'm here to help you with your insurance questions. Ask me about policies, claims, billing, or general insurance information.
            </Typography>
          </Box>
        )}

        {messages.map((message, index) => (
          <Fade key={`${message.id || 'msg'}_${message.timestamp || 'ts'}_${index}`} in timeout={300}>
            <Box
              sx={{
                display: 'flex',
                mb: 2,
                justifyContent: message.type === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  maxWidth: '70%',
                  flexDirection: message.type === 'user' ? 'row-reverse' : 'row',
                }}
              >
                {getMessageAvatar(message)}
                <Box>
                  {getAgentLabel(message) && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {getAgentLabel(message)}
                    </Typography>
                  )}
                  <Paper
                    elevation={1}
                    sx={{
                      p: 2,
                      borderRadius: 3,
                      backgroundColor: message.type === 'user' ? 'primary.main' : 'background.paper',
                      color: message.type === 'user' ? 'white' : 'text.primary',
                      wordBreak: 'break-word',
                      '& p': { m: 0, mb: 1 },
                      '& p:last-child': { mb: 0 },
                      '& ul, & ol': { pl: 2, mt: 1, mb: 1 },
                      '& h1, & h2, & h3': { mt: 2, mb: 1, fontWeight: 'bold' },
                      '& h1': { fontSize: '1.5rem' },
                      '& h2': { fontSize: '1.25rem' },
                      '& h3': { fontSize: '1.1rem' },
                      '& strong': { fontWeight: 700 },
                      '& a': { color: 'primary.main' },
                    }}
                  >
                    {message.type === 'user' ? (
                      <Typography variant="body1">{message.content}</Typography>
                    ) : (
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    )}
                  </Paper>
                  <Box display="flex" alignItems="center" gap={1} mt={0.5} ml={1}>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(message.timestamp).toLocaleTimeString(locale, timeZone ? { timeZone } : undefined)}
                    </Typography>
                    {message.type === 'agent' && (
                      <IconButton 
                        size="small" 
                        onClick={() => handleSpeak(message.content, message.id || index)}
                        color={isSpeaking && speakingMessageId === (message.id || index) ? "primary" : "default"}
                        title={isSpeaking && speakingMessageId === (message.id || index) ? "Stop speaking" : "Read aloud"}
                      >
                         {isSpeaking && speakingMessageId === (message.id || index) ? <StopIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
                      </IconButton>
                    )}
                  </Box>
                </Box>
              </Box>
            </Box>
          </Fade>
        ))}

        {/* Typing Indicator */}
        {showTypingIndicator && (isTyping || typingUsers.size > 0) && (
          <Box display="flex" mb={2}>
            <Avatar sx={{ bgcolor: 'grey.400', width: 32, height: 32, mr: 1 }}>
              <SmartToyIcon />
            </Avatar>
            <Paper elevation={1} sx={{ p: 2, borderRadius: 3 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  AI Assistant is typing...
                </Typography>
              </Box>
            </Paper>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* Input Area */}
      <Paper elevation={3} sx={{ p: 2, borderRadius: 0 }}>
        {selectedImage && (
          <Box sx={{ mb: 2, position: 'relative', display: 'inline-block' }}>
            <img 
              src={selectedImage} 
              alt="Selected" 
              style={{ maxHeight: 100, borderRadius: 8, border: '1px solid #ddd' }} 
            />
            <IconButton
              size="small"
              onClick={handleRemoveImage}
              sx={{
                position: 'absolute',
                top: -8,
                right: -8,
                bgcolor: 'background.paper',
                border: '1px solid #ddd',
                '&:hover': { bgcolor: 'error.light', color: 'white' }
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
        <form onSubmit={handleSendMessage}>
          <Box display="flex" gap={1} alignItems="flex-end">
            <TextField
              fullWidth
              variant="outlined"
              placeholder="Type your insurance question here..."
              value={message}
              onChange={handleTyping}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              disabled={loading}
              multiline
              maxRows={4}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3,
                  paddingRight: '80px', // Make space for the icons
                },
              }}
              InputProps={{
                endAdornment: (
                  <Box sx={{ display: 'flex', position: 'absolute', right: 8, bottom: 8 }}>
                    <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        ref={fileInputRef}
                        onChange={handleImageSelect}
                    />
                    <IconButton
                        size="small"
                        onClick={() => fileInputRef.current?.click()}
                        color={selectedImage ? "primary" : "default"}
                    >
                        <ImageIcon />
                    </IconButton>
                    <IconButton
                        size="small"
                        color={isListening ? "secondary" : "default"}
                        onClick={handleVoiceInput}
                        sx={{ 
                            bgcolor: isListening ? 'action.hover' : 'transparent',
                            animation: isListening ? 'pulse 1.5s infinite' : 'none',
                            '@keyframes pulse': {
                                '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0, 0, 0, 0.2)' },
                                '70%': { transform: 'scale(1.1)', boxShadow: '0 0 0 10px rgba(0, 0, 0, 0)' },
                                '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0, 0, 0, 0)' }
                            }
                        }}
                    >
                        <MicIcon color={isListening ? "error" : "inherit"} />
                    </IconButton>
                  </Box>
                ),
              }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={!message.trim() || loading}
              sx={{ minWidth: 56, height: 56, borderRadius: 3 }}
            >
              {loading ? <CircularProgress size={24} /> : <SendIcon />}
            </Button>
          </Box>
        </form>
      </Paper>
      </Box>
    </Box>
  );
};

export default Chat;
