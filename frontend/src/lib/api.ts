import axios from 'axios';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Health check
export const checkHealth = async () => {
  const response = await api.get('/health');
  return response.data;
};

// Configuration
export const fetchConfig = async () => {
  const response = await api.get('/api/config');
  return response.data;
};

export const updateConfig = async (config: any) => {
  const response = await api.post('/api/config', config);
  return response.data;
};

// Platforms
export const fetchPlatforms = async () => {
  const response = await api.get('/api/platforms');
  return response.data;
};

export const fetchProfiles = async () => {
  const response = await api.get('/api/profiles');
  return response.data;
};

export const triggerFetch = async () => {
  const response = await api.post('/api/fetch');
  return response.data;
};

// Analysis
export const fetchAnalysis = async () => {
  const response = await api.get('/api/analysis');
  return response.data;
};

export const triggerAnalysis = async () => {
  const response = await api.post('/api/analysis');
  return response.data;
};

export default api;
