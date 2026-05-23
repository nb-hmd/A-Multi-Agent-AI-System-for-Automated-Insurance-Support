import React, { useState, useEffect } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  Paper,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  Description as FileIcon,
  CheckCircle as SuccessIcon,
  CarCrash as IncidentIcon,
  AttachMoney as MoneyIcon,
  DateRange as DateIcon,
  Description as DescIcon
} from '@mui/icons-material';
import dataService from '../../services/dataService';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

const steps = ['Select Policy', 'Incident Details', 'Evidence Upload', 'Review & Submit'];

const FileClaimWizard = ({ onClose, onSuccess }) => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  
  const [formData, setFormData] = useState({
    policyNumber: '',
    incidentType: '',
    incidentDate: new Date().toISOString().slice(0, 10),
    description: '',
    estimatedLoss: '',
    evidenceFiles: []
  });

  useEffect(() => {
    fetchPolicies();
  }, []);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      const customerId = user?.customerId;
      if (!customerId) return;
      const resp = await dataService.getPolicies(customerId, { limit: 100, status: 'active' });
      const policyList = resp?.policies || [];
      setPolicies(policyList);
      if (policyList.length > 0 && !formData.policyNumber) {
        setFormData(prev => ({ ...prev, policyNumber: policyList[0].policy_number }));
      }
    } catch (error) {
      console.error('Error fetching policies', error);
      showNotification('Failed to load policies', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (activeStep === steps.length - 1) {
      handleSubmit();
    } else {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const handleChange = (field) => (e) => {
    setFormData({ ...formData, [field]: e.target.value });
  };

  const handleFileUpload = () => {
    // Mock file upload
    const fileNum = formData.evidenceFiles.length + 1;
    const newFile = `evidence_photo_${fileNum}.jpg`;
    setFormData(prev => ({
      ...prev,
      evidenceFiles: [...prev.evidenceFiles, newFile]
    }));
    showNotification('File uploaded successfully (Mock)', 'success');
  };

  const handleRemoveFile = (index) => {
    setFormData(prev => ({
      ...prev,
      evidenceFiles: prev.evidenceFiles.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Validate data before submission
      if (!formData.policyNumber || !formData.incidentType || !formData.incidentDate || !formData.estimatedLoss || !formData.description) {
        showNotification('Please fill in all required fields', 'error');
        setSubmitting(false);
        return;
      }

      await dataService.fileClaim(
        formData.policyNumber,
        formData.incidentType,
        Number(formData.estimatedLoss),
        formData.incidentDate,
        formData.description,
        formData.evidenceFiles
      );
      showNotification('Claim filed successfully!', 'success');
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Error filing claim', error);
      const errorMsg = error.response?.data?.message || 'Failed to file claim. Please try again.';
      showNotification(errorMsg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const isStepValid = () => {
    switch (activeStep) {
      case 0: // Policy
        return !!formData.policyNumber;
      case 1: // Details
        return !!formData.incidentType && !!formData.incidentDate && !!formData.estimatedLoss && !!formData.description;
      case 2: // Evidence
        return true; // Optional
      default:
        return true;
    }
  };

  const renderStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Box mt={2}>
            <Typography variant="h6" gutterBottom>
              Select the Policy for this Claim
            </Typography>
            <FormControl fullWidth margin="normal">
              <InputLabel>Policy</InputLabel>
              <Select
                value={formData.policyNumber}
                label="Policy"
                onChange={handleChange('policyNumber')}
              >
                {policies.map((p) => (
                  <MenuItem key={p.policy_number} value={p.policy_number}>
                    {p.policy_number} - {p.policy_type} (Exp: {new Date(p.end_date).toLocaleDateString()})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {policies.length === 0 && !loading && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                You have no active policies to file a claim against.
              </Alert>
            )}
          </Box>
        );
      case 1:
        return (
          <Box mt={2}>
            <Typography variant="h6" gutterBottom>
              Tell us what happened
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Incident Date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={formData.incidentDate}
                  onChange={handleChange('incidentDate')}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth margin="normal">
                  <InputLabel>Incident Type</InputLabel>
                  <Select
                    value={formData.incidentType}
                    label="Incident Type"
                    onChange={handleChange('incidentType')}
                  >
                    <MenuItem value="Collision">Collision</MenuItem>
                    <MenuItem value="Theft">Theft</MenuItem>
                    <MenuItem value="Vandalism">Vandalism</MenuItem>
                    <MenuItem value="Weather Damage">Weather Damage</MenuItem>
                    <MenuItem value="Medical">Medical / Injury</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Estimated Loss Amount ($)"
                  type="number"
                  value={formData.estimatedLoss}
                  onChange={handleChange('estimatedLoss')}
                  margin="normal"
                  InputProps={{
                    startAdornment: <MoneyIcon color="action" sx={{ mr: 1 }} />
                  }}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description of Incident"
                  multiline
                  rows={4}
                  value={formData.description}
                  onChange={handleChange('description')}
                  margin="normal"
                  placeholder="Please describe exactly what happened..."
                />
              </Grid>
            </Grid>
          </Box>
        );
      case 2:
        return (
          <Box mt={2}>
            <Typography variant="h6" gutterBottom>
              Upload Evidence
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Please upload photos of the damage, police reports, or any other relevant documents.
            </Typography>
            
            <Box 
              sx={{ 
                border: '2px dashed', 
                borderColor: 'divider', 
                borderRadius: 2, 
                p: 4, 
                textAlign: 'center',
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' }
              }}
              onClick={handleFileUpload}
            >
              <UploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
              <Typography variant="button" display="block" color="primary">
                Click to Upload File
              </Typography>
              <Typography variant="caption" color="text.secondary">
                (Mock Upload for Demo)
              </Typography>
            </Box>

            <List sx={{ mt: 2 }}>
              {formData.evidenceFiles.map((file, index) => (
                <ListItem 
                  key={index}
                  secondaryAction={
                    <IconButton edge="end" onClick={() => handleRemoveFile(index)}>
                      <DeleteIcon />
                    </IconButton>
                  }
                >
                  <ListItemIcon>
                    <FileIcon />
                  </ListItemIcon>
                  <ListItemText primary={file} />
                </ListItem>
              ))}
            </List>
          </Box>
        );
      case 3:
        return (
          <Box mt={2}>
            <Typography variant="h6" gutterBottom>
              Review Claim Details
            </Typography>
            <Alert severity="info" sx={{ mb: 3 }}>
              Please review the information below before submitting your claim.
            </Alert>
            
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Policy</Typography>
                <Typography variant="body1" gutterBottom>{formData.policyNumber}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Incident Type</Typography>
                <Typography variant="body1" gutterBottom>{formData.incidentType}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Date</Typography>
                <Typography variant="body1" gutterBottom>{formData.incidentDate}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Estimated Loss</Typography>
                <Typography variant="body1" gutterBottom>${formData.estimatedLoss}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary">Description</Typography>
                <Typography variant="body1" paragraph sx={{ bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                  {formData.description}
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary">Evidence Files</Typography>
                <Typography variant="body1">
                  {formData.evidenceFiles.length > 0 ? `${formData.evidenceFiles.length} file(s) attached` : 'No files attached'}
                </Typography>
              </Grid>
            </Grid>
          </Box>
        );
      default:
        return 'Unknown step';
    }
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Stepper activeStep={activeStep} alternativeLabel>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      
      <Box sx={{ mt: 4, mb: 2, minHeight: 300 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          renderStepContent(activeStep)
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'row', pt: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button
          color="inherit"
          disabled={activeStep === 0 || submitting}
          onClick={handleBack}
          sx={{ mr: 1 }}
        >
          Back
        </Button>
        <Box sx={{ flex: '1 1 auto' }} />
        {activeStep === steps.length - 1 ? (
          <Button 
            variant="contained" 
            color="primary" 
            onClick={handleSubmit}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={20} /> : <SuccessIcon />}
          >
            {submitting ? 'Submitting...' : 'Submit Claim'}
          </Button>
        ) : (
          <Button 
            variant="contained" 
            onClick={handleNext}
            disabled={!isStepValid()}
          >
            Next
          </Button>
        )}
      </Box>
    </Box>
  );
};

export default FileClaimWizard;