import React, { useEffect, useMemo } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemText,
  Typography,
  IconButton,
  Divider,
  Button,
  Paper,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  ChatBubbleOutline as ChatIcon,
} from '@mui/icons-material';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';

const ChatSidebar = ({ onClose }) => {
  const { 
    sessions, 
    fetchSessions, 
    loadConversation, 
    deleteChatSession, 
    activeConversation,
    createConversation,
    setActiveConversation
  } = useChat();
  const { user } = useAuth();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleNewChat = () => {
    // Create a new local conversation ID or just reset active conversation
    const newId = createConversation(user?.customerId, null);
    setActiveConversation(newId);
    if (onClose) onClose();
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId !== activeConversation) {
      loadConversation(sessionId);
    }
    if (onClose) onClose();
  };

  const handleDeleteSession = (e, sessionId) => {
    e.stopPropagation();
    deleteChatSession(sessionId);
  };

  const groupedSessions = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = {
      Today: [],
      Yesterday: [],
      'Previous 7 Days': [],
      'Older': []
    };

    sessions.forEach(session => {
      const date = new Date(session.updatedAt);
      
      if (date.toDateString() === today.toDateString()) {
        groups.Today.push(session);
      } else if (date.toDateString() === yesterday.toDateString()) {
        groups.Yesterday.push(session);
      } else if (date > new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
        groups['Previous 7 Days'].push(session);
      } else {
        groups['Older'].push(session);
      }
    });

    return groups;
  }, [sessions]);

  return (
    <Box sx={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column', borderRight: 1, borderColor: 'divider' }}>
      <Box p={2}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleNewChat}
          sx={{ borderRadius: 2 }}
        >
          New Chat
        </Button>
      </Box>
      
      <Divider />
      
      <List sx={{ flex: 1, overflowY: 'auto', px: 1 }}>
        {Object.entries(groupedSessions).map(([label, group]) => (
          group.length > 0 && (
            <React.Fragment key={label}>
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block', fontWeight: 'bold' }}>
                {label}
              </Typography>
              {group.map((session) => (
                <ListItem
                  key={session.sessionId}
                  button
                  selected={activeConversation === session.sessionId}
                  onClick={() => handleSelectSession(session.sessionId)}
                  sx={{ 
                    borderRadius: 2, 
                    mb: 0.5,
                    '&.Mui-selected': {
                      backgroundColor: 'action.selected',
                    }
                  }}
                  secondaryAction={
                    <Tooltip title="Delete chat">
                      <IconButton 
                        edge="end" 
                        size="small" 
                        onClick={(e) => handleDeleteSession(e, session.sessionId)}
                        sx={{ opacity: 0, transition: 'opacity 0.2s', '.MuiListItem-root:hover &': { opacity: 1 } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <ListItemText
                    primary={session.title || 'New Chat'}
                    primaryTypographyProps={{ 
                      noWrap: true, 
                      variant: 'body2',
                      fontWeight: activeConversation === session.sessionId ? 'bold' : 'normal'
                    }}
                    secondary={new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              ))}
            </React.Fragment>
          )
        ))}
        {sessions.length === 0 && (
          <Box p={2} textAlign="center">
            <Typography variant="body2" color="text.secondary">
              No chat history
            </Typography>
          </Box>
        )}
      </List>
    </Box>
  );
};

export default ChatSidebar;