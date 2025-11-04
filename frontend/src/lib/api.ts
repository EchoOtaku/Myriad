import axios from 'axios';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid, clear it and redirect to login
      localStorage.removeItem('auth_token');
      window.dispatchEvent(new CustomEvent('auth-state-changed', { 
        detail: { isAuthenticated: false } 
      }));
      // Optionally show a message
      console.warn('Authentication expired, please login again');
    }
    return Promise.reject(error);
  }
);

// Health check
export const checkHealth = async () => {
  const response = await api.get('/health');
  return response.data;
};

// Setup APIs
export const checkSetupStatus = async () => {
  const response = await api.get('/api/setup/status');
  return response.data;
};

export const saveDatabaseConfig = async (config: {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}) => {
  const response = await api.post('/api/setup/database-config', config);
  return response.data;
};

export const initDatabase = async () => {
  const response = await api.post('/api/setup/init-database');
  return response.data;
};

export const createAdmin = async (credentials: {
  username: string;
  password: string;
}) => {
  const response = await api.post('/api/setup/create-admin', credentials);
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
