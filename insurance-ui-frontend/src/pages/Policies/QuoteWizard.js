
import React, { useState } from 'react';
import {
  Box,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Button,
  Grid,
  Card,
  CardActionArea,
  CardContent,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Divider,
  Checkbox,
  FormControlLabel,
  FormHelperText
} from '@mui/material';
import {
  DirectionsCar as CarIcon,
  Home as HomeIcon,
  Favorite as HeartIcon
} from '@mui/icons-material';
import dataService from '../../services/dataService';
import { useNotification } from '../../context/NotificationContext';

const steps = ['Choose Type', 'Enter Details', 'Review Quote', 'Purchase'];

const QuoteWizard = ({ onClose, onSuccess }) => {
  const { showNotification } = useNotification();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quote, setQuote] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  const [formData, setFormData] = useState({
    type: '',
    details: {
      // Auto
      vehicleYear: new Date().getFullYear(),
      vehicleMake: '',
      vehicleModel: '',
      vehicleVin: '',
      coverageType: 'standard', // liability, standard, premium
      
      // Home
      sqft: '',
      yearBuilt: '',
      address: '',
      
      // Life
      age: '',
      gender: '',
      smoker: false,
      coverageAmount: 100000,
      termLength: 20
    }
  });

  const validateStep = () => {
    const errors = {};
    const { type, details } = formData;

    if (activeStep === 0) {
      if (!type) errors.type = "Please select a policy type";
    }

    if (activeStep === 1) {
      if (type === 'auto') {
        if (!details.vehicleYear) errors.vehicleYear = "Year is required";
        if (!details.vehicleMake) errors.vehicleMake = "Make is required";
        if (!details.vehicleModel) errors.vehicleModel = "Model is required";
        if (!details.vehicleVin) errors.vehicleVin = "VIN is required";
      } else if (type === 'home') {
        if (!details.address) errors.address = "Address is required";
        if (!details.sqft) errors.sqft = "Square footage is required";
        if (!details.yearBuilt) errors.yearBuilt = "Year built is required";
      } else if (type === 'life') {
        if (!details.age) errors.age = "Age is required";
        if (!details.gender) errors.gender = "Gender is required";
        if (!details.coverageAmount) errors.coverageAmount = "Coverage amount is required";
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = async () => {
    if (!validateStep()) {
      return;
    }

    if (activeStep === 1) {
      // Get Quote
      setLoading(true);
      try {
        const quoteResult = await dataService.getQuote(formData.type, formData.details);
        setQuote(quoteResult);
        setActiveStep((prev) => prev + 1);
      } catch (err) {
        setError('Failed to calculate quote. Please try again.');
      } finally {
        setLoading(false);
      }
    } else if (activeStep === 2) {
      // Purchase
      setLoading(true);
      try {
        await dataService.createPolicy({
          type: formData.type,
          details: formData.details,
          premium: quote.premium
        });
        showNotification('Policy purchased successfully!', 'success');
        if (onSuccess) onSuccess();
      } catch (err) {
        console.error("Purchase failed:", err);
        setError('Failed to purchase policy. ' + (err.response?.data?.message || err.message));
      } finally {
        setLoading(false);
      }
    } else {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
    setValidationErrors({});
    setError(null);
  };

  const updateDetails = (field, value) => {
    setFormData(prev => ({
      ...prev,
      details: { ...prev.details, [field]: value }
    }));
    // Clear error when user types
    if (validationErrors[field]) {
      setValidationErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const renderStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Card 
                variant="outlined" 
                sx={{ 
                  borderColor: formData.type === 'auto' ? 'primary.main' : undefined,
                  bgcolor: formData.type === 'auto' ? 'action.hover' : undefined,
                  height: '100%'
                }}
              >
                <CardActionArea 
                  onClick={() => {
                    setFormData(p => ({ ...p, type: 'auto' }));
                    setValidationErrors({});
                  }} 
                  sx={{ p: 4, textAlign: 'center', height: '100%' }}
                >
                  <CarIcon sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
                  <Typography variant="h6">Auto Insurance</Typography>
                  <Typography variant="body2" color="text.secondary">Protect your vehicle</Typography>
                </CardActionArea>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card 
                variant="outlined" 
                sx={{ 
                  borderColor: formData.type === 'home' ? 'primary.main' : undefined,
                  bgcolor: formData.type === 'home' ? 'action.hover' : undefined,
                  height: '100%'
                }}
              >
                <CardActionArea 
                  onClick={() => {
                    setFormData(p => ({ ...p, type: 'home' }));
                    setValidationErrors({});
                  }} 
                  sx={{ p: 4, textAlign: 'center', height: '100%' }}
                >
                  <HomeIcon sx={{ fontSize: 60, color: 'secondary.main', mb: 2 }} />
                  <Typography variant="h6">Home Insurance</Typography>
                  <Typography variant="body2" color="text.secondary">Protect your property</Typography>
                </CardActionArea>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card 
                variant="outlined" 
                sx={{ 
                  borderColor: formData.type === 'life' ? 'primary.main' : undefined,
                  bgcolor: formData.type === 'life' ? 'action.hover' : undefined,
                  height: '100%'
                }}
              >
                <CardActionArea 
                  onClick={() => {
                    setFormData(p => ({ ...p, type: 'life' }));
                    setValidationErrors({});
                  }} 
                  sx={{ p: 4, textAlign: 'center', height: '100%' }}
                >
                  <HeartIcon sx={{ fontSize: 60, color: 'error.main', mb: 2 }} />
                  <Typography variant="h6">Life Insurance</Typography>
                  <Typography variant="body2" color="text.secondary">Protect your loved ones</Typography>
                </CardActionArea>
              </Card>
            </Grid>
          </Grid>
        );

      case 1:
        if (formData.type === 'auto') {
          return (
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="Vehicle Year" type="number" required
                  value={formData.details.vehicleYear}
                  onChange={(e) => updateDetails('vehicleYear', e.target.value)}
                  error={!!validationErrors.vehicleYear}
                  helperText={validationErrors.vehicleYear}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="Make (e.g. Toyota)" required
                  value={formData.details.vehicleMake}
                  onChange={(e) => updateDetails('vehicleMake', e.target.value)}
                  error={!!validationErrors.vehicleMake}
                  helperText={validationErrors.vehicleMake}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="Model (e.g. Camry)" required
                  value={formData.details.vehicleModel}
                  onChange={(e) => updateDetails('vehicleModel', e.target.value)}
                  error={!!validationErrors.vehicleModel}
                  helperText={validationErrors.vehicleModel}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="VIN" required
                  value={formData.details.vehicleVin}
                  onChange={(e) => updateDetails('vehicleVin', e.target.value)}
                  error={!!validationErrors.vehicleVin}
                  helperText={validationErrors.vehicleVin}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Coverage Level</InputLabel>
                  <Select
                    value={formData.details.coverageType}
                    label="Coverage Level"
                    onChange={(e) => updateDetails('coverageType', e.target.value)}
                  >
                    <MenuItem value="liability">Liability Only (Basic)</MenuItem>
                    <MenuItem value="standard">Standard (Collision + Comprehensive)</MenuItem>
                    <MenuItem value="premium">Premium (All Features)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          );
        } else if (formData.type === 'home') {
          return (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField 
                  fullWidth label="Property Address" required
                  value={formData.details.address}
                  onChange={(e) => updateDetails('address', e.target.value)}
                  error={!!validationErrors.address}
                  helperText={validationErrors.address}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="Square Footage" type="number" required
                  value={formData.details.sqft}
                  onChange={(e) => updateDetails('sqft', e.target.value)}
                  error={!!validationErrors.sqft}
                  helperText={validationErrors.sqft}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="Year Built" type="number" required
                  value={formData.details.yearBuilt}
                  onChange={(e) => updateDetails('yearBuilt', e.target.value)}
                  error={!!validationErrors.yearBuilt}
                  helperText={validationErrors.yearBuilt}
                />
              </Grid>
            </Grid>
          );
        } else if (formData.type === 'life') {
          return (
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="Age" type="number" required
                  value={formData.details.age}
                  onChange={(e) => updateDetails('age', e.target.value)}
                  error={!!validationErrors.age}
                  helperText={validationErrors.age}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!validationErrors.gender} required>
                  <InputLabel>Gender</InputLabel>
                  <Select
                    value={formData.details.gender}
                    label="Gender"
                    onChange={(e) => updateDetails('gender', e.target.value)}
                  >
                    <MenuItem value="male">Male</MenuItem>
                    <MenuItem value="female">Female</MenuItem>
                  </Select>
                  {validationErrors.gender && <FormHelperText>{validationErrors.gender}</FormHelperText>}
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField 
                  fullWidth label="Coverage Amount ($)" type="number" required
                  value={formData.details.coverageAmount}
                  onChange={(e) => updateDetails('coverageAmount', e.target.value)}
                  error={!!validationErrors.coverageAmount}
                  helperText={validationErrors.coverageAmount}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Term Length (Years)</InputLabel>
                  <Select
                    value={formData.details.termLength}
                    label="Term Length (Years)"
                    onChange={(e) => updateDetails('termLength', e.target.value)}
                  >
                    <MenuItem value={10}>10 Years</MenuItem>
                    <MenuItem value={20}>20 Years</MenuItem>
                    <MenuItem value={30}>30 Years</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formData.details.smoker}
                      onChange={(e) => updateDetails('smoker', e.target.checked)}
                    />
                  }
                  label="I am a smoker"
                />
              </Grid>
            </Grid>
          );
        }
        return null;

      case 2:
        return (
          <Box textAlign="center" py={2}>
            <Typography variant="h5" gutterBottom>Your Quote Ready!</Typography>
            <Typography variant="h3" color="primary.main" fontWeight="bold" my={3}>
              ${quote?.premium}<Typography component="span" variant="h6" color="text.secondary">/year</Typography>
            </Typography>
            
            <Card variant="outlined" sx={{ maxWidth: 400, mx: 'auto', textAlign: 'left' }}>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom>Quote Breakdown:</Typography>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Base Premium</Typography>
                  <Typography variant="body2">${quote?.breakdown?.base}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Risk Adjustments</Typography>
                  <Typography variant="body2">+${quote?.breakdown?.adjustments}</Typography>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="subtitle1" fontWeight="bold">Total</Typography>
                  <Typography variant="subtitle1" fontWeight="bold">${quote?.premium}</Typography>
                </Box>
              </CardContent>
            </Card>
          </Box>
        );

      default:
        return 'Unknown step';
    }
  };

  return (
    <Box>
      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ minHeight: 300 }}>
        {renderStepContent(activeStep)}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'row', pt: 2, mt: 4, borderTop: 1, borderColor: 'divider' }}>
        <Button
          color="inherit"
          disabled={activeStep === 0 || loading}
          onClick={handleBack}
          sx={{ mr: 1 }}
        >
          Back
        </Button>
        <Box sx={{ flex: '1 1 auto' }} />
        <Button
          onClick={handleNext}
          variant="contained"
          disabled={loading}
        >
          {loading ? <CircularProgress size={24} /> : activeStep === steps.length - 2 ? 'Purchase Policy' : 'Next'}
        </Button>
      </Box>
    </Box>
  );
};

export default QuoteWizard;
