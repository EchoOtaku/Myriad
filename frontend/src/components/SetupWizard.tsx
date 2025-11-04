import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { FaCheck, FaSpinner, FaDatabase, FaUser, FaExclamationTriangle } from 'react-icons/fa';

interface SetupStatus {
  is_setup_required: boolean;
  has_database: boolean;
  has_admin_user: boolean;
  has_github_oauth: boolean;
  has_gemini_api: boolean;
  missing_configs: string[];
}

const SetupWizard: React.FC = () => {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 数据库配置
  const [dbConfig, setDbConfig] = useState({
    host: 'localhost',
    port: '5432',
    database: 'myriad',
    username: 'postgres',
    password: '',
  });
  const [savingDb, setSavingDb] = useState(false);
  const [migratingDb, setMigratingDb] = useState(false);
  const [dbConfigured, setDbConfigured] = useState(false);

  // 管理员账户
  const [adminForm, setAdminForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [adminCreated, setAdminCreated] = useState(false);

  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    try {
      setLoading(true);
      
      // 先检查健康状态,看是否处于配置模式
      const healthResponse = await fetch(`${API_URL}/health`);
      if (!healthResponse.ok) {
        throw new Error('Failed to connect to backend');
      }
      const healthData = await healthResponse.json();
      
      // 如果处于配置模式(数据库未连接),显示数据库配置界面
      if (healthData.mode === 'configuration' || !healthData.database_connected) {
        setStatus({
          is_setup_required: true,
          has_database: false,
          has_admin_user: false,
          has_github_oauth: false,
          has_gemini_api: false,
          missing_configs: ['Database not configured'],
        });
        setDbConfigured(false);
        setAdminCreated(false);
        setLoading(false);
        return;
      }
      
      // 如果数据库已连接,检查详细的设置状态
      const response = await fetch(`${API_URL}/api/setup/status`);
      if (!response.ok) {
        // 如果是 503，说明某些功能还未就绪，但不是连接问题
        if (response.status === 503) {
          console.warn('Setup endpoints not yet available, using health data');
          // 使用健康检查数据创建基本状态
          setStatus({
            is_setup_required: true,
            has_database: healthData.database_connected,
            has_admin_user: false,
            has_github_oauth: false,
            has_gemini_api: false,
            missing_configs: ['Checking configuration...'],
          });
          // 数据库已连接，应该显示下一步
          setDbConfigured(true);
          setAdminCreated(false);
          setLoading(false);
          return;
        }
        throw new Error('Failed to check setup status');
      }
      const data = await response.json();
      setStatus(data);
      // 数据库连接成功就算配置完成，即使表还没初始化
      // 因为用户接下来就要初始化数据库
      setDbConfigured(healthData.database_connected);
      setAdminCreated(data.has_admin_user);
    } catch (err) {
      setError('无法连接到后端服务，请确保服务器正在运行');
      console.error('Failed to check setup status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDbConfig = async () => {
    if (!dbConfig.password) {
      alert('❌ 请输入数据库密码');
      return;
    }

    setSavingDb(true);

    try {
      // 使用新的数据库配置 API
      const response = await fetch(`${API_URL}/api/setup/database-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: dbConfig.host,
          port: parseInt(dbConfig.port),
          username: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '保存配置失败');
      }

      const result = await response.json();
      
      if (result.reload_triggered) {
        alert('✅ 数据库配置已保存！\n\n🔄 后端正在重新连接数据库...\n\n请稍候，页面将自动检测连接状态。');
        
        // 开始轮询检查数据库连接状态
        pollDatabaseConnection();
      } else {
        alert('✅ 数据库配置已保存！\n\n⚠️ 请手动重启后端服务以应用更改。');
      }
    } catch (err: any) {
      alert('❌ 保存配置失败: ' + err.message);
      setSavingDb(false);
    }
  };

  // 轮询检查数据库连接状态
  const pollDatabaseConnection = async () => {
    let attempts = 0;
    const maxAttempts = 30; // 最多尝试30次（60秒）
    const pollInterval = 2000; // 每2秒检查一次

    const checkConnection = async () => {
      attempts++;
      
      try {
        const healthResponse = await fetch(`${API_URL}/health`);
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          
          // 检查是否已经连接到数据库（不再是配置模式）
          if (healthData.database_connected && healthData.mode !== 'configuration') {
            console.log('✅ 数据库连接成功！');
            alert('🎉 数据库连接成功！\n\n系统已切换到正常模式，现在可以继续配置。');
            setSavingDb(false);
            setDbConfigured(true);
            checkSetupStatus();
            return;
          }
        }
      } catch (err) {
        console.error('轮询检查失败:', err);
      }

      // 如果还没成功且未超过最大尝试次数，继续轮询
      if (attempts < maxAttempts) {
        setTimeout(checkConnection, pollInterval);
      } else {
        // 超时
        alert('⚠️ 数据库连接超时\n\n配置已保存，但数据库连接可能失败。\n请检查配置是否正确，或手动重启后端服务。');
        setSavingDb(false);
        checkSetupStatus();
      }
    };

    // 等待3秒后开始第一次检查（给后端一些处理时间）
    setTimeout(checkConnection, 3000);
  };

  const handleMigrateDatabase = async () => {
    setMigratingDb(true);

    try {
      const response = await fetch(`${API_URL}/api/setup/init-database`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '数据库迁移失败');
      }

      const result = await response.json();
      
      // 显示详细的验证信息
      let message = '✅ ' + result.message;
      if (result.verification) {
        const v = result.verification;
        message += `\n\n📊 验证结果：`;
        message += `\n• 总表数：${v.total_tables}`;
        message += `\n• users 表：${v.users_table ? '✓' : '✗'}`;
        message += `\n• platforms 表：${v.platforms_table ? '✓' : '✗'}`;
        message += `\n• configurations 表：${v.configurations_table ? '✓' : '✗'}`;
      }
      
      alert(message);
      
      // 重新检查状态以更新 UI
      await checkSetupStatus();
    } catch (err: any) {
      alert('❌ 数据库迁移失败: ' + err.message);
    } finally {
      setMigratingDb(false);
    }
  };

  const handleCreateAdmin = async () => {
    if (adminForm.username.length < 3 || adminForm.username.length > 20) {
      alert('❌ 用户名必须为 3-20 个字符');
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(adminForm.username)) {
      alert('❌ 用户名只能包含字母、数字和下划线');
      return;
    }

    if (adminForm.password.length < 8) {
      alert('❌ 密码至少需要 8 个字符');
      return;
    }

    if (adminForm.password !== adminForm.confirmPassword) {
      alert('❌ 两次输入的密码不一致');
      return;
    }

    setCreatingAdmin(true);

    try {
      const response = await fetch(`${API_URL}/api/setup/create-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: adminForm.username,
          password: adminForm.password,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '创建管理员账户失败');
      }

      alert('✅ 管理员账户创建成功！');
      setAdminCreated(true);
      checkSetupStatus();
    } catch (err: any) {
      alert('❌ 创建失败: ' + err.message);
    } finally {
      setCreatingAdmin(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <FaSpinner 
            className="animate-spin text-6xl mx-auto mb-4" 
            style={{ color: 'var(--color-primary)' }}
          />
          <p className="text-gray-600">检查系统状态...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md glass rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FaExclamationTriangle className="text-3xl text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">连接失败</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={checkSetupStatus}
            className="px-6 py-3 text-white rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--color-dark)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-dark)')}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!status) return null;

  // 如果设置完成，显示完成页面
  if (!status.is_setup_required) {
    return (
      <div className="min-h-screen px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="glass rounded-2xl shadow-xl p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <FaCheck className="text-4xl text-green-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">系统配置完成！</h2>
            <p className="text-gray-600 mb-8">
              您的 Myriad 系统已经准备就绪，可以开始使用了。
            </p>
            <a
              href="/login"
              className="inline-block px-8 py-3 text-white rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--color-dark)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-dark)')}
            >
              前往登录
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-12">
      <div className="max-w-6xl mx-auto">
        {/* 进度标签栏 */}
        <div className="flex justify-center mb-6">
          <div className="glass rounded-xl p-1.5 inline-flex gap-1.5">
            <div
              className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 flex items-center gap-2 ${
                !dbConfigured
                  ? 'bg-white shadow-sm'
                  : ''
              }`}
              style={!dbConfigured ? { color: 'var(--color-dark)' } : { color: 'var(--color-primary)' }}
            >
              {dbConfigured ? <FaCheck className="text-green-600" /> : <FaDatabase />}
              <span>数据库配置</span>
            </div>
            <div
              className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 flex items-center gap-2 ${
                dbConfigured && !adminCreated
                  ? 'bg-white shadow-sm'
                  : ''
              }`}
              style={
                dbConfigured && !adminCreated
                  ? { color: 'var(--color-dark)' }
                  : dbConfigured && adminCreated
                    ? { color: 'var(--color-primary)' }
                    : { color: 'var(--color-light)' }
              }
            >
              {adminCreated ? <FaCheck className="text-green-600" /> : <FaUser />}
              <span>管理员账户</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* 数据库配置卡片 */}
          {!dbConfigured && (
            <div className="glass rounded-xl p-5">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                      style={{ 
                        background: `linear-gradient(to bottom right, var(--color-accent), var(--color-light))`,
                        color: 'var(--color-dark)'
                      }}
                    >
                      <FaDatabase />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-gray-800">数据库配置</h2>
                      <p className="text-xs text-gray-500 mt-0.5">配置 PostgreSQL 数据库连接并运行迁移</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* 配置模式提示 */}
                    {!dbConfigured && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <FaExclamationTriangle className="text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-amber-800 mb-1">
                              🔧 后端运行在配置模式
                            </p>
                            <p className="text-xs text-amber-700">
                              数据库未连接。请配置数据库信息，保存后系统将自动重启并连接数据库。
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* 配置表单 */}
                    <div className="bg-white/50 rounded-lg p-4 border border-gray-200/50">
                      <h3 className="font-semibold text-gray-800 mb-3 text-sm">连接信息</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">主机地址</label>
                          <input
                            type="text"
                            value={dbConfig.host}
                            onChange={(e) => setDbConfig({ ...dbConfig, host: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="localhost"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">端口</label>
                          <input
                            type="text"
                            value={dbConfig.port}
                            onChange={(e) => setDbConfig({ ...dbConfig, port: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="5432"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">数据库名</label>
                          <input
                            type="text"
                            value={dbConfig.database}
                            onChange={(e) => setDbConfig({ ...dbConfig, database: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="myriad"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">用户名</label>
                          <input
                            type="text"
                            value={dbConfig.username}
                            onChange={(e) => setDbConfig({ ...dbConfig, username: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="postgres"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">密码</label>
                          <input
                            type="password"
                            value={dbConfig.password}
                            onChange={(e) => setDbConfig({ ...dbConfig, password: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="输入数据库密码"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-3">
                      <button
                        onClick={handleSaveDbConfig}
                        disabled={savingDb || !dbConfig.password}
                        className="w-full py-3 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold flex items-center justify-center gap-2 shadow-lg"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                        onMouseEnter={(e) => !savingDb && dbConfig.password && (e.currentTarget.style.backgroundColor = 'var(--color-dark)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-primary)')}
                      >
                        {savingDb ? <FaSpinner className="animate-spin" /> : '💾'}
                        <span>{savingDb ? '保存中...' : '保存并连接数据库'}</span>
                      </button>
                    </div>
                    
                    {/* 说明文字 */}
                    <div className="text-xs text-gray-500 text-center">
                      💡 提示：保存配置后，后端将自动重新连接数据库
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 管理员账户卡片 */}
          {dbConfigured && !adminCreated && (
            <div className="glass rounded-xl p-5">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                      style={{ 
                        background: `linear-gradient(to bottom right, var(--color-primary), var(--color-secondary))`,
                        color: 'white'
                      }}
                    >
                      <FaUser />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-gray-800">管理员账户</h2>
                      <p className="text-xs text-gray-500 mt-0.5">创建系统管理员账户</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* 数据库表初始化提示 */}
                    {status && !status.has_database && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <FaDatabase className="text-blue-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-blue-800 mb-2">
                              📋 需要初始化数据库表
                            </p>
                            <p className="text-xs text-blue-700 mb-3">
                              数据库连接成功，但表结构还未创建。请先初始化数据库。
                            </p>
                            <button
                              onClick={handleMigrateDatabase}
                              disabled={migratingDb}
                              className="w-full py-2 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold flex items-center justify-center gap-2"
                              style={{ backgroundColor: 'var(--color-primary)' }}
                              onMouseEnter={(e) => !migratingDb && (e.currentTarget.style.backgroundColor = 'var(--color-dark)')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-primary)')}
                            >
                              {migratingDb ? <FaSpinner className="animate-spin" /> : <FaDatabase />}
                              <span>{migratingDb ? '初始化中...' : '初始化数据库表'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* 管理员表单 - 仅在数据库已初始化后显示 */}
                    {status && status.has_database && (
                      <>
                        {/* 说明 */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-sm text-blue-800 mb-2">
                            创建本地管理员账户，该账户拥有系统完整管理权限
                          </p>
                          <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                            <li>用户名：3-20 个字符，仅支持字母、数字和下划线</li>
                            <li>密码：至少 8 个字符</li>
                          </ul>
                        </div>

                        {/* 表单 */}
                        <div className="bg-white/50 rounded-lg p-4 border border-gray-200/50">
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">用户名 *</label>
                              <input
                                type="text"
                                value={adminForm.username}
                                onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                placeholder="admin"
                                pattern="^[a-zA-Z0-9_]{3,20}$"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">密码 *</label>
                              <input
                                type="password"
                                value={adminForm.password}
                                onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                placeholder="至少8个字符"
                                minLength={8}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">确认密码 *</label>
                              <input
                                type="password"
                                value={adminForm.confirmPassword}
                                onChange={(e) => setAdminForm({ ...adminForm, confirmPassword: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                placeholder="再次输入密码"
                                minLength={8}
                              />
                            </div>
                          </div>
                        </div>

                        {/* 创建按钮 */}
                        <button
                          onClick={handleCreateAdmin}
                          disabled={creatingAdmin}
                          className="w-full py-2.5 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold flex items-center justify-center gap-2"
                          style={{ backgroundColor: 'var(--color-dark)' }}
                          onMouseEnter={(e) => !creatingAdmin && (e.currentTarget.style.backgroundColor = 'var(--color-secondary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-dark)')}
                        >
                          {creatingAdmin ? <FaSpinner className="animate-spin" /> : <FaUser />}
                          <span>{creatingAdmin ? '创建中...' : '创建管理员账户'}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetupWizard;