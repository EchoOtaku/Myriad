/**
 * 数据管理视图组件
 * 管理 API 元数据和 AI 生成的报告
 */

import { useState, useEffect } from 'react';
import AnimatedView from '../components/AnimatedView';
import Toast from '../components/Toast';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import TokenManager from '../utils/tokenManager';
import '../components/ConfigForm.css';

interface PlatformMetadata {
  platform_name: string;
  user_id: string;
  fetched_at: string;
  data_size: number;
}

interface CardContent {
  summary: string;
  details: string[];
  highlight?: string;
  tags: string[];
}

interface ReportCard {
  topic_id: number;
  title: string;
  category: string;
  icon: string;
  color: string;
  content: CardContent;
  generated_at?: string;
}

interface Report {
  id: string;
  cards: ReportCard[];
  created_at: string;
}

export default function DataManagement() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState('');
  
  // 元数据管理
  const [metadataList, setMetadataList] = useState<PlatformMetadata[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [refreshingPlatform, setRefreshingPlatform] = useState<string | null>(null);
  
  // 报告管理
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());

  // 检查管理员权限
  useEffect(() => {
    async function checkAdmin() {
      const token = TokenManager.getToken();
      if (!token) {
        navigate('/login', { replace: true });
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          navigate('/login', { replace: true });
          return;
        }

        const user = await response.json();
        if (!user.is_admin) {
          navigate('/', { replace: true });
          return;
        }

        setIsAdmin(true);
      } catch (error) {
        navigate('/login', { replace: true });
      } finally {
        setLoading(false);
      }
    }

    checkAdmin();
  }, [navigate]);

  // 加载元数据列表
  const loadMetadata = async () => {
    setMetadataLoading(true);
    try {
      const token = TokenManager.getToken();
      const response = await fetch(`${API_URL}/api/profile/metadata`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await response.json();
      
      if (data.success && data.data) {
        // data.data 是平台数据对象：{ steam: {...}, bilibili: {...}, github: {...} }
        const platformData = data.data;
        const metadata: PlatformMetadata[] = Object.entries(platformData).map(([platformName, platformInfo]: [string, any]) => {
          const dataSize = JSON.stringify(platformInfo).length;
          
          return {
            platform_name: platformName,
            user_id: 'default_user',
            fetched_at: data.fetched_at || new Date().toISOString(),
            data_size: dataSize
          };
        });
        setMetadataList(metadata);
      } else {
        setMetadataList([]);
      }
    } catch (error) {
      setMessage('✗ 加载元数据失败');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setMetadataLoading(false);
    }
  };

  // 加载报告列表
  const loadReports = async () => {
    setReportsLoading(true);
    try {
      const token = TokenManager.getToken();
      const response = await fetch(`${API_URL}/api/profile/reports`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await response.json();
      
      if (data.success && data.reports && Array.isArray(data.reports)) {
        // 为每个报告获取完整内容
        const reportPromises = data.reports.map(async (reportSummary: any) => {
          try {
            const detailResponse = await fetch(`${API_URL}/api/profile/reports/${reportSummary.id}`, {
              headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            const detailData = await detailResponse.json();
            
            if (detailData.success && detailData.report) {
              return {
                id: reportSummary.id,
                cards: detailData.report.cards || [],
                created_at: reportSummary.generated_at || reportSummary.cached_at
              };
            }
          } catch (error) {
            console.error(`Failed to load report ${reportSummary.id}:`, error);
          }
          return null;
        });
        
        const reportList = (await Promise.all(reportPromises)).filter(r => r !== null) as Report[];
        setReports(reportList);
      }
    } catch (error) {
      console.error('Failed to load reports:', error);
      setMessage('✗ 加载报告失败');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setReportsLoading(false);
    }
  };

  // 强制刷新单个平台数据
  const refreshSinglePlatform = async (platformName: string) => {
    if (!confirm(`确定要强制刷新 ${platformName} 的数据吗？`)) return;
    
    setRefreshingPlatform(platformName);
    try {
      const token = TokenManager.getToken();
      
      // 第一步：删除缓存
      await fetch(`${API_URL}/api/profile/cache`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      
      // 第二步：重新获取所有平台数据
      const response = await fetch(`${API_URL}/api/profile/fetch-all`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await response.json();
      
      if (data.success) {
        setMessage(`✓ ${platformName} 数据已刷新`);
        setTimeout(() => loadMetadata(), 500);
      } else {
        setMessage('✗ ' + (data.message || '刷新失败'));
      }
    } catch (error) {
      setMessage('✗ 刷新失败');
    } finally {
      setRefreshingPlatform(null);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  // 删除单个平台缓存
  const deleteSinglePlatform = async (platformName: string) => {
    if (!confirm(`确定要删除 ${platformName} 的缓存数据吗？删除后需要重新获取。`)) return;
    
    try {
      const token = TokenManager.getToken();
      const response = await fetch(`${API_URL}/api/profile/cache`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await response.json();
      
      // 404 表示缓存文件不存在，也算成功
      if (data.success || response.status === 404) {
        setMessage(`✓ ${platformName} 缓存已删除`);
        setTimeout(() => loadMetadata(), 500);
      } else {
        setMessage('✗ ' + (data.message || '删除失败'));
      }
    } catch (error) {
      setMessage('✗ 删除失败');
    }
    setTimeout(() => setMessage(''), 3000);
  };

  // 刷新所有平台数据
  const refreshPlatformData = async () => {
    if (!confirm('确定要刷新所有平台数据吗？将清理缓存并重新获取。')) return;
    
    setMetadataLoading(true);
    try {
      const token = TokenManager.getToken();
      
      // 第一步：删除缓存
      await fetch(`${API_URL}/api/profile/cache`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      
      // 第二步：重新获取所有平台数据
      const response = await fetch(`${API_URL}/api/profile/fetch-all`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await response.json();
      
      if (data.success) {
        setMessage('✓ 所有平台数据已刷新');
        setTimeout(() => loadMetadata(), 500);
      } else {
        setMessage('✗ ' + (data.message || '操作失败'));
      }
    } catch (error) {
      setMessage('✗ 操作失败');
    } finally {
      setMetadataLoading(false);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  // 删除单个报告
  const deleteReport = async (reportId: string) => {
    if (!confirm('确定要删除这个报告吗？')) return;
    
    try {
      const token = TokenManager.getToken();
      const response = await fetch(`${API_URL}/api/profile/reports/${reportId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await response.json();
      
      if (data.success) {
        setMessage('✓ 报告已删除');
        loadReports();
      } else {
        setMessage('✗ ' + (data.message || '删除失败'));
      }
    } catch (error) {
      setMessage('✗ 删除失败');
    }
    setTimeout(() => setMessage(''), 3000);
  };

  // 删除报告中的单个卡片
  const deleteCard = async (reportId: string, cardIndex: number, cardTitle: string) => {
    if (!confirm(`确定要删除卡片 "${cardTitle}" 吗？`)) return;
    
    try {
      const token = TokenManager.getToken();
      const response = await fetch(`${API_URL}/api/profile/reports/${reportId}/cards`, {
        method: 'DELETE',
        headers: token ? {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_index: cardIndex })
      });
      const data = await response.json();
      
      if (data.success) {
        setMessage('✓ 卡片已删除');
        loadReports();
      } else {
        setMessage('✗ ' + (data.message || '删除失败'));
      }
    } catch (error) {
      setMessage('✗ 删除失败');
    }
    setTimeout(() => setMessage(''), 3000);
  };

  // 删除所有报告
  const deleteAllReports = async () => {
    if (!confirm('确定要删除所有报告吗？此操作不可恢复！')) return;
    if (!confirm('再次确认：真的要删除所有报告吗？')) return;
    
    try {
      const token = TokenManager.getToken();
      const response = await fetch(`${API_URL}/api/profile/reports/all`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await response.json();
      
      if (data.success) {
        setMessage(`✓ 已删除 ${data.deleted_count} 个报告`);
        setReports([]);
      } else {
        setMessage('✗ ' + (data.message || '删除失败'));
      }
    } catch (error) {
      setMessage('✗ 删除失败');
    }
    setTimeout(() => setMessage(''), 3000);
  };

  // 切换报告展开状态
  const toggleReport = (reportId: string) => {
    const newExpanded = new Set(expandedReports);
    if (newExpanded.has(reportId)) {
      newExpanded.delete(reportId);
    } else {
      newExpanded.add(reportId);
    }
    setExpandedReports(newExpanded);
  };

  // 辅助函数：获取平台图标
  const getPlatformIcon = (platformName: string): string => {
    const icons: Record<string, string> = {
      'steam': '🎮',
      'bilibili': '📺',
      'github': '💻',
      'spotify': '🎵'
    };
    return icons[platformName.toLowerCase()] || '🌐';
  };

  // 辅助函数：格式化字节大小
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  useEffect(() => {
    if (isAdmin) {
      loadMetadata();
      loadReports();
    }
  }, [isAdmin]);

  if (loading) {
    return (
      <AnimatedView className="modern-config-loading">
        <div className="modern-spinner"></div>
        <p>加载中...</p>
      </AnimatedView>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <AnimatedView className="min-h-screen px-4 sm:px-6 pt-20 pb-24 md:pb-12">
      {message && <Toast message={message} />}

      <div className="max-w-6xl mx-auto">
        {/* 返回按钮 */}
        <button
          onClick={() => navigate('/config')}
          className="back-to-config-button"
          title="返回配置页"
          aria-label="返回配置页"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>返回配置</span>
        </button>

        {/* API 元数据管理 */}
        <div className="config-section">
          <div className="section-header">
            <div className="section-header-left">
              <span className="section-icon icon-platforms">📡</span>
              <div>
                <h2 className="section-title">API 平台元数据</h2>
                <p className="section-description">从各平台获取的 API 数据缓存 · {metadataList.length} 条</p>
              </div>
            </div>
            <button
              onClick={refreshPlatformData}
              className="test-button-inline"
              disabled={metadataLoading}
            >
              {metadataLoading ? (
                <div className="button-spinner"></div>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              全部刷新
            </button>
          </div>

          <div className="config-form">
            {metadataLoading ? (
              <div className="info-card loading-container">
                <div className="button-spinner spinner-center"></div>
                <p className="info-text loading-text">加载中...</p>
              </div>
            ) : metadataList.length === 0 ? (
              <div className="info-card empty-container">
                <p className="info-title">暂无元数据缓存</p>
                <p className="info-text empty-text">
                  访问首页后会自动生成平台数据缓存
                </p>
              </div>
            ) : (
              <div className="platforms-grid">
                {metadataList.map((metadata, index) => (
                  <div key={index} className="platform-card">
                    <div className="platform-header">
                      <div className="platform-info">
                        <div className="platform-icon-wrapper">
                          <span className="platform-icon-large">
                            {metadata.platform_name === 'steam' ? '🎮' :
                             metadata.platform_name === 'bilibili' ? '📺' :
                             metadata.platform_name === 'github' ? '💻' :
                             metadata.platform_name === 'spotify' ? '🎵' : '🌐'}
                          </span>
                        </div>
                        <div className="platform-details">
                          <h3 className="platform-name platform-name-capitalize">
                            {metadata.platform_name}
                          </h3>
                          <p className="platform-desc">
                            {new Date(metadata.fetched_at).toLocaleString('zh-CN')} · {(metadata.data_size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                      </div>
                      <div className="platform-actions platform-actions-gap">
                        <button
                          onClick={() => refreshSinglePlatform(metadata.platform_name)}
                          disabled={refreshingPlatform === metadata.platform_name}
                          className="config-icon-button button-success"
                          title="强制刷新此平台数据"
                          aria-label="强制刷新此平台数据"
                        >
                          {refreshingPlatform === metadata.platform_name ? (
                            <div className="button-spinner spinner-small"></div>
                          ) : (
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => deleteSinglePlatform(metadata.platform_name)}
                          className="config-icon-button button-danger"
                          title="删除此平台缓存"
                          aria-label="删除此平台缓存"
                        >
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI 报告管理 */}
        <div className="config-section">
          <div className="section-header">
            <div className="section-header-left">
              <span className="section-icon icon-ai">🤖</span>
              <div>
                <h2 className="section-title">AI 生成的报告</h2>
                <p className="section-description">管理 AI 分析报告和单个卡片 · {reports.length} 个报告</p>
              </div>
            </div>
            {reports.length > 0 && (
              <button
                onClick={deleteAllReports}
                className="test-button-inline button-danger"
                aria-label="删除全部报告"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除全部
              </button>
            )}
          </div>

          <div className="config-form">
            {reportsLoading ? (
              <div className="info-card loading-container">
                <div className="button-spinner spinner-center"></div>
                <p className="info-text loading-text">加载中...</p>
              </div>
            ) : reports.length === 0 ? (
              <div className="info-card empty-container">
                <p className="info-title">暂无报告</p>
                <p className="info-text empty-text">
                  生成 AI 报告后将显示在这里
                </p>
              </div>
            ) : (
              <div className="config-items-list">
                {reports.map((report) => {
                  const isExpanded = expandedReports.has(report.id);
                  return (
                    <div key={report.id} className="platform-card">
                      <div className="platform-header">
                        <div className="platform-info report-header-clickable" onClick={() => toggleReport(report.id)}>
                          <button
                            className={`config-icon-button report-expand-button ${isExpanded ? 'expanded' : ''}`}
                            aria-label={isExpanded ? '收起报告' : '展开报告'}
                            title={isExpanded ? '收起报告' : '展开报告'}
                          >
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <div className="platform-details report-details-flex">
                            <h3 className="platform-name">
                              报告 ID: {report.id.substring(0, 12)}...
                            </h3>
                            <p className="platform-desc">
                              {new Date(report.created_at).toLocaleString('zh-CN')} · {report.cards.length} 个卡片
                            </p>
                          </div>
                        </div>
                        <div className="platform-actions">
                          <button
                            onClick={() => deleteReport(report.id)}
                            className="config-icon-button button-danger"
                            title="删除报告"
                            aria-label="删除报告"
                          >
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="platform-config">
                          <div className="config-items-list">
                            {report.cards.map((card, index) => (
                              <div key={index} className="ai-status-card">
                                <div className="status-info card-content-flex">
                                  <div className="card-header">
                                    <span className="card-icon">{card.icon}</span>
                                    <span className="platform-name">{card.title}</span>
                                    <span 
                                      className="card-category-badge"
                                      data-color={card.color}
                                    >
                                      {card.category}
                                    </span>
                                  </div>
                                  <p className="platform-desc card-summary">
                                    {card.content.summary}
                                  </p>
                                  {card.content.details && card.content.details.length > 0 && (
                                    <ul className="card-details-list">
                                      {card.content.details.map((detail, i) => (
                                        <li key={i} className="platform-desc card-detail-item">{detail}</li>
                                      ))}
                                    </ul>
                                  )}
                                  {card.content.highlight && (
                                    <p className="card-highlight">
                                      {card.content.highlight}
                                    </p>
                                  )}
                                  {card.content.tags && card.content.tags.length > 0 && (
                                    <div className="card-tags-container">
                                      {card.content.tags.map((tag, i) => (
                                        <span key={i} className="card-tag">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => deleteCard(report.id, index, card.title)}
                                  className="config-icon-button button-delete-card"
                                  title="删除此卡片"
                                  aria-label={`删除卡片 ${card.title}`}
                                >
                                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AnimatedView>
  );
}

