import { useState, useEffect } from 'react';
import { Settings, Play, Database, MessageSquare, Plus, Activity, ChevronDown, CheckCircle2, Save, Search, LayoutTemplate, LayoutDashboard, Send, UploadCloud, Download, Clock, Shuffle, CalendarClock, Smartphone, Users, MessageCircle, Timer, Zap, Rocket, X } from 'lucide-react';
import { TemplateManager } from './components/TemplateManager';

type IntegrationConfig = {
  enabled: boolean;
  [key: string]: any;
};

type Logic = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  lastRun?: string;
  config: {
    googleSheets: IntegrationConfig;
    crm: IntegrationConfig;
    whatsapp: IntegrationConfig;
    cron?: IntegrationConfig;
  };
};

const DEFAULT_LOGIC: Logic = {
  id: 'new',
  name: 'Nova Lógica de Disparo',
  status: 'inactive',
  config: {
    googleSheets: {
      enabled: true,
      sheetId: '',
      sheetName: 'Página1',
      filterColumn: 'envio1',
      filters: [{ id: '1', column: 'envio1', operator: 'empty', value: '' }],
      followUpEnabled: false,
      followUpColumn: '',
      followUpHours: 48,
      limitRows: 50
    },
    crm: { enabled: false, apiUrl: 'https://saman.crm.mktlab.app/api', token: '', stageId: '83' },
    whatsapp: {
      enabled: true,
      phoneId: '',
      token: '',
      templateName: '',
      phoneColumns: [''],
      delayBetweenNumbers: 2,
      delayBetweenLeads: 5,
      randomizeNumbers: false,
      secondaryPhones: []
    },
    cron: {
      enabled: false,
      days: ['1', '2', '3', '4', '5'], // Seg a Sex
      startTime: '09:00',
      endTime: '18:59'
    }
  }
};

export default function App() {
  const [logics, setLogics] = useState<Logic[]>([{ ...DEFAULT_LOGIC, id: '1', name: 'Fluxo Exemplo (Personalizável)' }]);
  const [activeLogic, setActiveLogic] = useState<Logic>(logics[0]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isLoadingColumns, setIsLoadingColumns] = useState(false);
  const [sheetColumns, setSheetColumns] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<'dashboard' | 'logic' | 'settings' | 'wizard'>('dashboard');
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [isSavingCreds, setIsSavingCreds] = useState(false);
  const [authStatus, setAuthStatus] = useState({ hasCredentials: false, isConnected: false });
  const [executionLogs, setExecutionLogs] = useState<{ type: string, message: string, timestamp?: string }[]>(() => {
    const saved = localStorage.getItem('disparo_logs');
    return saved ? JSON.parse(saved) : [];
  });
  const [showLogModal, setShowLogModal] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [liveExecution, setLiveExecution] = useState<any>(null);
  const [detailsModalData, setDetailsModalData] = useState<any>(null);

  // Meta / Facebook state
  const [fbAppId, setFbAppId] = useState(() => localStorage.getItem('fb_app_id') || '');
  const [fbConfigId, setFbConfigId] = useState(() => localStorage.getItem('fb_config_id') || '');
  const [isFbConnected, setIsFbConnected] = useState(() => !!localStorage.getItem('fb_access_token'));
  const [fbPhoneAccounts, setFbPhoneAccounts] = useState<any[]>([]);
  const [isLoadingFb, setIsLoadingFb] = useState(false);
  const [selectedWabaForTemplates, setSelectedWabaForTemplates] = useState<{ id: string, name: string, targetIndex?: number } | null>(null);
  const [integrationView, setIntegrationView] = useState('hub'); // hub, google, meta
  const [wizardProvider, setWizardProvider] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardContacts, setWizardContacts] = useState<{ nome: string, telefone: string }[]>([]);
  const [csvStatus, setCsvStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);

  useEffect(() => {
    localStorage.setItem('disparo_logs', JSON.stringify(executionLogs));
  }, [executionLogs]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isExecuting) {
        e.preventDefault();
        e.returnValue = 'Um disparo está em andamento. Atualizar a página irá interromper o processo. Tem certeza?';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isExecuting]);

  useEffect(() => {
    if (isFbConnected) {
      const token = localStorage.getItem('fb_access_token');
      if (token) {
        fetchWhatsAppAccounts(token);
      }
    }
  }, [isFbConnected]);

  useEffect(() => {
    // Forçar tema dark por padrão
    document.body.classList.add('dark');

    // Carregar status OAuth e Token da Meta
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => {
        setAuthStatus(d);
        if (d.metaToken) {
          localStorage.setItem('fb_access_token', d.metaToken);
          setIsFbConnected(true);
        }
      })
      .catch(() => { });

    // Carregar Lógicas salvas
    fetch('/api/db/logics')
      .then(r => r.json())
      .then(d => {
        if (d && d.length > 0) {
          setLogics(d);
          setActiveLogic(d[0]);
        }
      })
      .catch(() => { });

    // Carregar Histórico
    fetch('/api/db/history')
      .then(r => r.json())
      .then(d => {
        if (d) setHistory(d);
      })
      .catch(() => { });

    // Check if URL has ?auth=success
    if (window.location.search.includes('auth=success')) {
      alert('Conta do Google conectada com sucesso!');
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  useEffect(() => {
    // Monitor de execução em background (Cron ou abas perdidas)
    const interval = setInterval(() => {
      if (!activeLogic?.id) return;
      fetch('/api/status')
        .then(r => r.json())
        .then(d => {
          if (d.activeLogics && d.activeLogics.includes(activeLogic.id)) {
            if (!isExecuting) {
              setIsExecuting(true);
            }
          } else {
            // Se o backend diz que não tá rodando, mas o frontend acha que tá (e não tem SSE vivo)
            if (isExecuting && !liveExecution) {
              setIsExecuting(false);
              // Tentar atualizar a tabela
              fetch('/api/db/history').then(r => r.json()).then(d => setHistory(d)).catch(() => { });
            }
          }
        })
        .catch(() => { });
    }, 3000);
    return () => clearInterval(interval);
  }, [activeLogic?.id, isExecuting, liveExecution]);

  const handleConfigChange = (integration: keyof Logic['config'], field: string, value: any) => {
    setActiveLogic(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [integration]: {
          ...prev.config[integration],
          [field]: value
        }
      }
    }));
  };

  const handleStop = async () => {
    try {
      await fetch('/api/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ logicId: activeLogic.id })
      });
      // O botão pode demorar 3s para voltar ao normal no modo background.
      if (!liveExecution) {
        setIsExecuting(false);
        alert('Sinal de parada enviado para o disparo em background. Ele será abortado.');
      }
    } catch (e) {
      console.error('Erro ao parar a execução:', e);
    }
  };

  const handleAddFilter = () => {
    const newFilters = [...(activeLogic.config.googleSheets.filters || [])];
    newFilters.push({ id: Date.now().toString(), column: '', operator: 'empty', value: '' });
    handleConfigChange('googleSheets', 'filters', newFilters);
  };

  const handleFilterChange = (id: string, field: string, value: string) => {
    const newFilters = activeLogic.config.googleSheets.filters.map((f: any) =>
      f.id === id ? { ...f, [field]: value } : f
    );
    handleConfigChange('googleSheets', 'filters', newFilters);
  };

  const handleRemoveFilter = (id: string) => {
    const newFilters = activeLogic.config.googleSheets.filters.filter((f: any) => f.id !== id);
    handleConfigChange('googleSheets', 'filters', newFilters);
  };

  const loadColumns = async () => {
    const { sheetId, sheetName } = activeLogic.config.googleSheets;
    if (!sheetId || !sheetName) {
      alert("Preencha o ID da Planilha e o Nome da Aba primeiro.");
      return;
    }
    try {
      setIsLoadingColumns(true);
      const res = await fetch('/api/sheet-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ sheetId, sheetName })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Erro ao buscar colunas');
      }
      const data = await res.json();
      setSheetColumns(data.columns);
    } catch (error: any) {
      alert(`Erro: ${error.message}. Certifique-se de que o backend está rodando e a Service Account tem permissão.`);
    } finally {
      setIsLoadingColumns(false);
    }
  };

  const handleSave = async () => {
    let newLogic;
    setLogics(prev => {
      const exists = prev.find(l => l.id === activeLogic.id);
      if (exists) {
        newLogic = activeLogic;
        return prev.map(l => l.id === activeLogic.id ? activeLogic : l);
      }
      newLogic = { ...activeLogic, id: Date.now().toString() };
      setActiveLogic(newLogic);
      return [...prev, newLogic];
    });

    try {
      await fetch('/api/db/logics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ logic: newLogic || activeLogic })
      });
      alert('Lógica salva com sucesso no Banco de Dados!');
    } catch (e) {
      alert('Erro ao salvar no banco!');
    }
  };

  const runDisparo = async () => {
    setShowLogModal(true);
    setExecutionLogs([{ type: 'info', message: 'Preparando campanha...', timestamp: new Date().toLocaleTimeString() }]);
    setIsExecuting(true);

    setLiveExecution({
      id: 'live',
      logicName: activeLogic.name || 'Nova Campanha V4',
      sheetName: wizardContacts.length > 0 ? 'Planilha CSV' : (activeLogic.config.googleSheets?.sheetName || ''),
      date: new Date().toLocaleString('pt-BR'),
      processed: 0,
      wpSent: 0,
      crmUpdates: 0,
      errors: 0,
      status: 'Rodando...',
      sentPhones: [],
      processedRows: []
    });

    let campaignId = '';

    if (wizardContacts.length > 0) {
      try {
        const res = await fetch('/api/prepare-campaign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
          body: JSON.stringify({ logic: activeLogic, contacts: wizardContacts })
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Erro ${res.status}: ${errText}`);
        }
        const data = await res.json();
        campaignId = data.campaignId;
      } catch (err: any) {
        setExecutionLogs([{ type: 'error', message: `Falha ao preparar campanha com os contatos. Erro: ${err.message}`, timestamp: new Date().toLocaleTimeString() }]);
        setIsExecuting(false);
        return;
      }
    }

    const endpoint = campaignId
      ? `/api/run-dynamic?campaignId=${campaignId}`
      : `/api/run-dynamic?logic=${encodeURIComponent(JSON.stringify(activeLogic))}`;

    const eventSource = new EventSource(endpoint);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'progress') {
          setLiveExecution((prev: any) => prev ? {
            ...prev,
            processed: data.processed,
            wpSent: data.wpSent,
            crmUpdates: data.crmUpdates,
            errors: data.errors,
            sentPhones: data.sentPhones || [],
            processedRows: data.processedRows || []
          } : null);
        } else {
          setExecutionLogs(prev => [...prev, { ...data, timestamp: new Date().toLocaleTimeString() }]);
        }

        if (data.type === 'done' || data.type === 'error' && data.message.includes('geral')) {
          eventSource.close();
          setIsExecuting(false);
          setLiveExecution(null);
          // Recarregar histórico
          fetch('/api/db/history')
            .then(r => r.json())
            .then(d => { if (d) setHistory(d); })
            .catch(() => { });
        }
      } catch (err) {
        console.error('Erro ao ler log:', err);
      }
    };

    eventSource.onerror = (err) => {
      setExecutionLogs(prev => [...prev, { type: 'error', message: 'Conexão com o servidor perdida.', timestamp: new Date().toLocaleTimeString() }]);
      eventSource.close();
      setIsExecuting(false);
      setLiveExecution(null);
    };
  };

  const saveGoogleCredentials = async () => {
    if (!oauthClientId || !oauthClientSecret) return alert('Preencha o Client ID e Client Secret.');
    try {
      setIsSavingCreds(true);
      const res = await fetch('/api/save-oauth-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ clientId: oauthClientId, clientSecret: oauthClientSecret })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Erro ao salvar credenciais');
      }
      setAuthStatus(prev => ({ ...prev, hasCredentials: true }));
      alert('Credenciais OAuth2 salvas! Agora clique em "Sign in with Google" para autenticar sua conta.');
    } catch (error: any) {
      alert(`Erro: ${error.message}`);
    } finally {
      setIsSavingCreds(false);
    }
  };

  const saveFbSettings = () => {
    if (!fbAppId) return alert('Preencha o Facebook App ID.');
    localStorage.setItem('fb_app_id', fbAppId);
    if (fbConfigId) localStorage.setItem('fb_config_id', fbConfigId);
    alert('Configurações do Meta salvas com sucesso!');
  };

  const fetchWhatsAppAccounts = async (token: string) => {
    setIsLoadingFb(true);
    try {
      const url = `https://graph.facebook.com/v20.0/me/businesses?limit=100&fields=id,name,owned_whatsapp_business_accounts.limit(500){id,name,phone_numbers.limit(500){id,display_phone_number,verified_name}}&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error.message || 'Erro do Meta');
      }

      let accounts: any[] = [];
      if (data.data) {
        data.data.forEach((biz: any) => {
          const processWabaList = (wabaList: any) => {
            if (wabaList && wabaList.data) {
              wabaList.data.forEach((waba: any) => {
                if (waba.phone_numbers && waba.phone_numbers.data) {
                  waba.phone_numbers.data.forEach((phone: any) => {
                    accounts.push({
                      id: phone.id,
                      display_phone_number: phone.display_phone_number,
                      verified_name: phone.verified_name,
                      wabaName: waba.name,
                      wabaId: waba.id,
                      businessName: biz.name
                    });
                  });
                }
              });
            }
          };

          processWabaList(biz.owned_whatsapp_business_accounts);
        });
      }

      // Ordenar por Empresa > Nome da Conta > Nome do Telefone
      accounts.sort((a, b) => {
        if (a.businessName !== b.businessName) return a.businessName.localeCompare(b.businessName);
        if (a.wabaName !== b.wabaName) return a.wabaName.localeCompare(b.wabaName);
        return (a.verified_name || '').localeCompare(b.verified_name || '');
      });
      setFbPhoneAccounts(accounts);
      if (accounts.length === 0) {
        alert('Nenhum número de WhatsApp Business encontrado para essa conta.');
      }
    } catch (e: any) {
      console.error(e);
      alert('Erro ao buscar contas do WhatsApp: ' + e.message);
    } finally {
      setIsLoadingFb(false);
    }
  };

  const doFbLogin = () => {
    const loginParams: any = {
      scope: 'whatsapp_business_management,whatsapp_business_messaging,business_management',
      return_scopes: true
    };

    // Se o usuário inseriu um Config ID (Embedded Signup Flow)
    if (fbConfigId) {
      loginParams.config_id = fbConfigId;
      loginParams.override_default_response_type = true;
      loginParams.extras = {
        version: "v3",
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3"
      };
    }

    (window as any).FB.login((response: any) => {
      if (response.authResponse) {
        const accessToken = response.authResponse.accessToken;
        localStorage.setItem('fb_access_token', accessToken);
        setIsFbConnected(true);
        fetchWhatsAppAccounts(accessToken);

        // Salvar token da Meta (White Label DB)
        fetch('/api/save-meta-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
          body: JSON.stringify({ token: accessToken })
        }).catch(console.error);
      } else {
        console.log('User cancelled login or did not fully authorize.');
      }
    }, loginParams);
  };

  const handleFbLogin = () => {
    if (!fbAppId) {
      alert("Por favor, preencha e salve o Facebook App ID primeiro na aba Configurações.");
      return;
    }

    setIsLoadingFb(true);
    if (!(window as any).FB) {
      (window as any).fbAsyncInit = function () {
        (window as any).FB.init({
          appId: fbAppId,
          cookie: true,
          xfbml: true,
          version: 'v20.0'
        });
        setIsLoadingFb(false);
        doFbLogin();
      };

      const script = document.createElement('script');
      script.src = "https://connect.facebook.net/pt_BR/sdk.js";
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        setIsLoadingFb(false);
        alert('Falha ao carregar o SDK do Facebook. Verifique adblockers.');
      }
      document.body.appendChild(script);
    } else {
      setIsLoadingFb(false);
      doFbLogin();
    }
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 2) {
          setCsvStatus({ type: 'error', message: 'O arquivo CSV parece estar vazio ou não tem cabeçalho.' });
          return;
        }

        const headers = lines[0].toLowerCase().split(',');
        const nomeIdx = headers.findIndex(h => h.includes('nome'));
        const telIdx = headers.findIndex(h => h.includes('telefone') || h.includes('numero') || h.includes('celular') || h.includes('contato'));

        if (nomeIdx === -1 || telIdx === -1) {
          setCsvStatus({ type: 'error', message: 'As colunas "nome" e "telefone" não foram encontradas. Verifique o cabeçalho do CSV.' });
          return;
        }

        const parsedContacts: { nome: string, telefone: string }[] = [];
        let errors = 0;

        for (let i = 1; i < lines.length; i++) {
          // Tratar vírgulas dentro de aspas num CSV básico
          let cols = lines[i].split(',');
          if (cols.length > Math.max(nomeIdx, telIdx)) {
            const rawPhone = cols[telIdx] || '';
            const rawNome = cols[nomeIdx] || '';

            // Remove tudo que não for dígito
            let cleanPhone = rawPhone.replace(/\D/g, '');

            // Validação simples de tamanho de número do Brasil (DDD + Número) = 10 ou 11
            // Se tiver 55 no começo, pode ter 12 ou 13
            if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10 && cleanPhone.length <= 11) {
              cleanPhone = '55' + cleanPhone;
            }

            if (cleanPhone.length >= 12) {
              parsedContacts.push({
                nome: rawNome.trim(),
                telefone: cleanPhone
              });
            } else {
              errors++;
            }
          }
        }

        setWizardContacts(parsedContacts);
        setCsvStatus({
          type: 'success',
          message: `${parsedContacts.length} contatos carregados com sucesso! ${errors > 0 ? `(${errors} ignorados por telefone inválido)` : ''}`
        });

      } catch (err) {
        setCsvStatus({ type: 'error', message: 'Erro ao processar o arquivo CSV.' });
      }
    };
    reader.readAsText(file);
    // Reset file input so same file can be uploaded again
    e.target.value = '';
  };

  return (
    <>
      <div className="app-shell">
        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="sidebar__header">
            <div className="org-switcher">
              <div className="org-badge org-badge--brand" style={{ fontFamily: 'var(--font-hero)', fontSize: '12px' }}>V4</div>
              <span className="org-name">Disparo em Massa</span>
              <span className="org-chevron"><ChevronDown size={14} /></span>
            </div>
          </div>

          <div className="sidebar__nav" style={{ paddingTop: '8px' }}>
            <div className="nav-section-label">Menu Principal</div>
            <button
              className={`nav-item ${currentView === 'dashboard' ? 'nav-item--active' : ''}`}
              onClick={() => setCurrentView('dashboard')}
            >
              <span className="nav-item__icon"><LayoutDashboard size={16} /></span>
              <span className="nav-item__label">Dashboard</span>
            </button>

            <button
              className={`nav-item ${currentView === 'wizard' ? 'nav-item--active' : ''}`}
              onClick={() => setCurrentView('wizard')}
            >
              <span className="nav-item__icon"><Plus size={16} /></span>
              <span className="nav-item__label">Novo Disparo</span>
            </button>



            <div className="nav-section-label mt-4">Plataforma</div>
            <button
              className={`nav-item ${currentView === 'settings' ? 'nav-item--active' : ''}`}
              onClick={() => { setCurrentView('settings'); setIntegrationView('hub'); }}
            >
              <span className="nav-item__icon"><Settings size={16} /></span>
              <span className="nav-item__label">Integrações</span>
            </button>
          </div>
        </div>

        <div className="main-area">
          {currentView === 'settings' && (
            <>
              <div className="topbar">
                <div className="topbar__left flex items-center gap-3">
                  <h3 className="h3 m-0" style={{ margin: 0 }}>Integrações</h3>
                  {integrationView !== 'hub' && (
                    <button className="btn btn--outline btn--sm" onClick={() => setIntegrationView('hub')}>
                      Voltar para Hub
                    </button>
                  )}
                </div>
              </div>
              <div className="main-content">
                <div className="content-wrapper">

                  {integrationView === 'hub' && (
                    <>
                      <div className="page-header">
                        <div className="page-header__greeting">Hub de Integrações</div>
                        <div className="page-header__title">Conecte seus Aplicativos</div>
                        <div className="page-header__subtitle">Gerencie as conexões de serviços externos utilizados pelas suas lógicas de disparo.</div>
                      </div>

                      <div className="grid-2">
                        <div className="card" style={{ cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => setIntegrationView('google')}>
                          <div className="flex items-start gap-4">
                            <div style={{ backgroundColor: '#e8f0fe', padding: '12px', borderRadius: '12px', color: '#1a73e8' }}>
                              <Database size={28} />
                            </div>
                            <div>
                              <h4 className="h4 mb-1">Google Sheets</h4>
                              <p className="t-sm t-muted m-0 mb-3">Conecte sua conta do Google para ler planilhas de contatos automaticamente.</p>
                              {authStatus.isConnected ? (
                                <span className="badge badge--success">Conectado</span>
                              ) : (
                                <span className="badge badge--warning">Não Conectado</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="card" style={{ cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => setIntegrationView('meta')}>
                          <div className="flex items-start gap-4">
                            <div style={{ backgroundColor: '#e3f2fd', padding: '12px', borderRadius: '12px', color: '#1877F2' }}>
                              <MessageSquare size={28} />
                            </div>
                            <div>
                              <h4 className="h4 mb-1">WhatsApp Business (Meta)</h4>
                              <p className="t-sm t-muted m-0 mb-3">Conecte seu App do Facebook para listar números e enviar mensagens pela Graph API.</p>
                              {isFbConnected ? (
                                <span className="badge badge--success">Conectado</span>
                              ) : (
                                <span className="badge badge--warning">Não Conectado</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {integrationView === 'google' && (
                    <>
                      <div className="page-header">
                        <div className="page-header__greeting">Integração</div>
                        <div className="page-header__title">Google Sheets (OAuth2)</div>
                        <div className="page-header__subtitle">Configure seu aplicativo no Google Cloud e conecte sua conta para acessar as planilhas.</div>
                      </div>

                      <div className="card mb-6">
                        {authStatus.isConnected ? (
                          <div className="alert alert--success mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 size={16} /> <strong>Conta Conectada!</strong> Você já pode acessar suas planilhas.
                            </div>
                            <a href="/api/auth/google" className="btn btn--outline btn--sm" style={{ background: 'var(--card)', color: 'var(--foreground)' }}>Reconectar</a>
                          </div>
                        ) : (
                          <div className="alert alert--warning mb-4">
                            Ainda não conectado. Preencha as credenciais e clique em "Sign in with Google".
                          </div>
                        )}

                        <div className="form-group mb-4">
                          <label className="label">OAuth Redirect URL (Configure isso no Google Cloud)</label>
                          <input className="input" value="/api/oauth-callback" readOnly style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }} />
                        </div>

                        <div className="form-group mb-4">
                          <label className="label">Client ID *</label>
                          <input type="text" className="input" placeholder="Ex: 789089...apps.googleusercontent.com" value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} />
                        </div>

                        <div className="form-group mb-4">
                          <label className="label">Client Secret *</label>
                          <input type="password" className="input" placeholder="Sua chave secreta" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} />
                        </div>

                        <div className="flex items-center gap-3">
                          <button className="btn btn--outline" onClick={saveGoogleCredentials} disabled={isSavingCreds}>
                            <Save size={16} /> {isSavingCreds ? 'Salvando...' : 'Salvar Credenciais'}
                          </button>

                          {authStatus.hasCredentials && (
                            <a href="/api/auth/google" className="btn btn--primary" style={{ backgroundColor: '#4285f4', borderColor: '#4285f4' }}>
                              <span style={{ backgroundColor: '#fff', color: '#4285f4', padding: '2px 4px', borderRadius: '4px', marginRight: '6px', fontWeight: 'bold' }}>G</span> Sign in with Google
                            </a>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {integrationView === 'meta' && (
                    <>
                      <div className="page-header">
                        <div className="page-header__greeting">Integração</div>
                        <div className="page-header__title">Meta / Facebook Login</div>
                        <div className="page-header__subtitle">Configure seu App do Facebook para permitir o login direto e buscar suas contas de WhatsApp.</div>
                      </div>

                      <div className="card mb-6">
                        {isFbConnected ? (
                          <div className="alert alert--success mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 size={16} /> <strong>Conectado ao Meta!</strong> Você já pode listar suas contas de WhatsApp.
                            </div>
                            <button onClick={handleFbLogin} className="btn btn--outline btn--sm" style={{ background: 'var(--card)', color: 'var(--foreground)' }} disabled={isLoadingFb}>
                              {isLoadingFb ? 'Carregando...' : 'Reconectar'}
                            </button>
                          </div>
                        ) : (
                          <div className="alert alert--warning mb-4">
                            Ainda não conectado ao Meta. Configure o App ID e conecte-se.
                          </div>
                        )}

                        <div className="grid-2 mb-4">
                          <div className="form-group">
                            <label className="label">Facebook App ID *</label>
                            <input type="text" className="input" placeholder="Ex: 123456789012345" value={fbAppId} onChange={(e) => setFbAppId(e.target.value)} />
                            <p className="t-xs t-muted mt-1">Obrigatório.</p>
                          </div>
                          <div className="form-group">
                            <label className="label">Configuration ID (Embedded Signup)</label>
                            <input type="text" className="input" placeholder="Ex: 756855103454028" value={fbConfigId} onChange={(e) => setFbConfigId(e.target.value)} />
                            <p className="t-xs t-muted mt-1">Opcional. Para fluxo de Embedded Signup.</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <button className="btn btn--outline" onClick={saveFbSettings}>
                            <Save size={16} /> Salvar Configurações
                          </button>

                          {fbAppId && (
                            <button onClick={handleFbLogin} className="btn btn--primary" style={{ backgroundColor: '#1877F2', borderColor: '#1877F2' }} disabled={isLoadingFb}>
                              <span style={{ backgroundColor: '#fff', color: '#1877F2', padding: '2px 6px', borderRadius: '4px', marginRight: '6px', fontWeight: 'bold' }}>f</span> {isLoadingFb ? 'Carregando...' : 'Conectar ao Meta'}
                            </button>
                          )}
                        </div>

                        {isFbConnected && fbPhoneAccounts.length > 0 && (
                          <div className="mt-6 p-4" style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <h4 className="h4 mb-3">Suas Contas de WhatsApp Business</h4>
                            <div className="table-wrap">
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>Empresa (BM)</th>
                                    <th>Conta (WABA)</th>
                                    <th>Nome da Linha</th>
                                    <th>Número</th>
                                    <th>Phone ID</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {fbPhoneAccounts.map(acc => (
                                    <tr key={acc.id}>
                                      <td><span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>{acc.businessName}</span></td>
                                      <td>{acc.wabaName}</td>
                                      <td><strong style={{ color: 'var(--foreground)' }}>{acc.verified_name || 'Desconhecido'}</strong></td>
                                      <td>{acc.display_phone_number}</td>
                                      <td style={{ fontFamily: 'monospace', color: 'var(--muted-foreground)' }}>{acc.id}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                </div>
              </div>
            </>
          )}

          {currentView === 'dashboard' && (
            <>
              <div className="topbar">
                <div className="topbar__left">
                  <h3 className="h3 m-0" style={{ margin: 0 }}>Dashboard</h3>
                </div>
              </div>
              <div className="main-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <LayoutDashboard size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                  <h3 className="h3">Dashboard em breve!</h3>
                  <p>Esta será a tela principal com métricas e resumos do sistema.</p>
                </div>
              </div>
            </>
          )}

          {currentView === 'wizard' && (
            <>
              <div className="topbar">
                <div className="topbar__left">
                  <h3 className="h3 m-0" style={{ margin: 0 }}>Criar Novo Disparo</h3>
                </div>
              </div>
              <div className="main-content">
                <div className="content-wrapper">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ position: 'absolute', top: '50%', left: '0', right: '0', height: '2px', background: 'var(--border)', zIndex: 0, transform: 'translateY(-50%)' }}></div>
                      <div style={{ position: 'absolute', top: '50%', left: '0', width: `${((wizardStep - 1) / 4) * 100}%`, height: '2px', background: 'var(--primary)', zIndex: 0, transition: 'width 0.4s ease-out', transform: 'translateY(-50%)' }}></div>

                      {[
                        { id: 1, label: 'Conexão' },
                        { id: 2, label: 'Contatos' },
                        { id: 3, label: 'Mensagem' },
                        { id: 4, label: 'Ritmo' },
                        { id: 5, label: 'Revisão' }
                      ].map(step => (
                        <div key={step.id} onClick={() => setWizardStep(step.id)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, gap: '8px', width: '60px' }}>
                          <div style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            background: wizardStep >= step.id ? 'var(--primary)' : 'var(--card)',
                            color: wizardStep >= step.id ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                            border: `2px solid ${wizardStep >= step.id ? 'var(--primary)' : 'var(--border)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold',
                            transition: 'all 0.3s ease',
                            boxShadow: wizardStep === step.id ? '0 0 0 4px rgba(245, 158, 11, 0.2)' : 'none'
                          }}>
                            {wizardStep > step.id ? <CheckCircle2 size={16} /> : step.id}
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: wizardStep >= step.id ? 600 : 500, color: wizardStep >= step.id ? 'var(--foreground)' : 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{step.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {wizardStep === 1 && (
                    <div className="animation-fade-in">
                      <h3 className="h3 mb-4">Escolha a plataforma de envio</h3>
                      <div className="grid-3 mb-6">
                        <div
                          className="card"
                          style={{
                            border: wizardProvider === 'meta' ? '2px solid var(--primary)' : '1px solid var(--border)',
                            cursor: 'pointer',
                            background: wizardProvider === 'meta' ? 'var(--accent)' : 'var(--card)',
                            boxShadow: wizardProvider === 'meta' ? '0 8px 24px rgba(245, 158, 11, 0.15)' : 'var(--shadow-xs)',
                            transform: wizardProvider === 'meta' ? 'translateY(-4px)' : 'none',
                            transition: 'all 0.3s ease'
                          }}
                          onClick={() => setWizardProvider('meta')}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--primary)', color: 'var(--primary-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <MessageCircle size={20} />
                            </div>
                            {wizardProvider === 'meta' && <CheckCircle2 size={24} style={{ color: 'var(--primary)' }} />}
                          </div>
                          <h4 className="h4 mb-1" style={{ color: wizardProvider === 'meta' ? 'var(--primary)' : 'var(--foreground)' }}>API Oficial Meta</h4>
                          <p className="t-sm t-muted m-0">Envio 100% seguro contra banimento. Requer aprovação de templates.</p>
                        </div>
                        <div className="card" style={{ opacity: 0.5, cursor: 'not-allowed', filter: 'grayscale(1)' }}>
                          <div className="flex items-center justify-between mb-3">
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--secondary)', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Smartphone size={20} />
                            </div>
                          </div>
                          <h4 className="h4 mb-1">Evolution API</h4>
                          <p className="t-sm t-muted m-0">Conexão via QR Code. Em breve disponível.</p>
                        </div>
                        <div className="card" style={{ opacity: 0.5, cursor: 'not-allowed', filter: 'grayscale(1)' }}>
                          <div className="flex items-center justify-between mb-3">
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--secondary)', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Zap size={20} />
                            </div>
                          </div>
                          <h4 className="h4 mb-1">Quepasa Web</h4>
                          <p className="t-sm t-muted m-0">Motor de disparo em massa gratuito. Em breve.</p>
                        </div>
                      </div>

                      {wizardProvider === 'meta' && (
                        <div className="card mb-6 animation-fade-in">
                          <h4 className="h4 mb-4">Configuração - API Oficial</h4>

                          {!isFbConnected ? (
                            <div className="alert alert--warning mb-4">
                              Você não está conectado ao Meta. Acesse a aba "Integrações" para configurar seu App ID.
                            </div>
                          ) : (
                            <>
                              {fbPhoneAccounts.length > 0 && (
                                <div className="form-group mb-4">
                                  <label className="label">Selecione o Número Principal</label>
                                  <select className="select" onChange={(e) => {
                                    const selectedId = e.target.value;
                                    if (selectedId) {
                                      handleConfigChange('whatsapp', 'phoneId', selectedId);
                                      const token = localStorage.getItem('fb_access_token');
                                      if (token) handleConfigChange('whatsapp', 'token', token);
                                    }
                                  }} value={activeLogic.config.whatsapp.phoneId}>
                                    <option value="">-- Selecionar da minha conta Meta --</option>
                                    {fbPhoneAccounts.map(acc => (
                                      <option key={acc.id} value={acc.id} disabled={activeLogic.config.whatsapp.secondaryPhones?.some((s: any) => s.phoneId === acc.id)}>
                                        {acc.verified_name || acc.display_phone_number} ({acc.display_phone_number})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div className="form-group mb-4">
                                <label className="label">Phone ID Principal</label>
                                <input type="text" className="input" value={activeLogic.config.whatsapp.phoneId} onChange={(e) => handleConfigChange('whatsapp', 'phoneId', e.target.value)} />
                              </div>
                              <div className="form-group mb-4">
                                <label className="label">Access Token Principal</label>
                                <input type="password" className="input" value={activeLogic.config.whatsapp.token} onChange={(e) => handleConfigChange('whatsapp', 'token', e.target.value)} />
                              </div>

                              <div className="form-group mb-4">
                                <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontWeight: 600 }}>
                                  <input type="checkbox" checked={activeLogic.config.whatsapp.randomizeNumbers} onChange={(e) => handleConfigChange('whatsapp', 'randomizeNumbers', e.target.checked)} />
                                  Alternar envios (Randomizar)
                                </label>
                              </div>

                              {activeLogic.config.whatsapp.randomizeNumbers && (
                                <div style={{ padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px dashed var(--border)' }}>
                                  <div className="flex justify-between items-center mb-4">
                                    <h5 className="h5 m-0">Números Adicionais (Revezamento)</h5>
                                    <button
                                      className="btn btn--outline btn--sm"
                                      onClick={() => {
                                        const current = activeLogic.config.whatsapp.secondaryPhones || [];
                                        handleConfigChange('whatsapp', 'secondaryPhones', [...current, { phoneId: '', token: '' }]);
                                      }}
                                    >
                                      <Plus size={14} style={{ marginRight: '4px' }} /> Adicionar Número
                                    </button>
                                  </div>

                                  {(!activeLogic.config.whatsapp.secondaryPhones || activeLogic.config.whatsapp.secondaryPhones.length === 0) && (
                                    <p className="t-sm t-muted m-0 text-center py-4">Nenhum número adicional configurado. Adicione um para revezar os disparos.</p>
                                  )}

                                  {activeLogic.config.whatsapp.secondaryPhones?.map((sp: any, idx: number) => (
                                    <div key={idx} style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', marginBottom: '12px', position: 'relative' }}>
                                      <button
                                        style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'all 0.2s' }}
                                        className="hover:bg-red-500/10 hover:text-red-500"
                                        onClick={() => {
                                          const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                          current.splice(idx, 1);
                                          handleConfigChange('whatsapp', 'secondaryPhones', current);
                                        }}
                                      >
                                        <X size={16} />
                                      </button>

                                      <h6 className="m-0 mb-3" style={{ fontSize: '13px' }}>Número Secundário {idx + 1}</h6>

                                      {fbPhoneAccounts.length > 0 && (
                                        <div className="form-group mb-3">
                                          <label className="label">Selecionar Conta (Auto-preencher)</label>
                                          <select className="select" onChange={(e) => {
                                            const selectedId = e.target.value;
                                            if (selectedId) {
                                              const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                              current[idx].phoneId = selectedId;
                                              const token = localStorage.getItem('fb_access_token');
                                              if (token) current[idx].token = token;
                                              handleConfigChange('whatsapp', 'secondaryPhones', current);
                                            }
                                          }} value={sp.phoneId}>
                                            <option value="">-- Selecionar da lista --</option>
                                            {fbPhoneAccounts.map(acc => (
                                              <option key={acc.id} value={acc.id} disabled={activeLogic.config.whatsapp.phoneId === acc.id || activeLogic.config.whatsapp.secondaryPhones?.some((s: any, i: number) => i !== idx && s.phoneId === acc.id)}>
                                                {acc.verified_name || acc.display_phone_number} ({acc.display_phone_number})
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      )}

                                      <div className="grid-2">
                                        <div className="form-group">
                                          <label className="label">Phone ID</label>
                                          <input type="text" className="input" value={sp.phoneId} onChange={(e) => {
                                            const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                            current[idx].phoneId = e.target.value;
                                            handleConfigChange('whatsapp', 'secondaryPhones', current);
                                          }} />
                                        </div>
                                        <div className="form-group">
                                          <label className="label">Access Token</label>
                                          <input type="password" className="input" value={sp.token} onChange={(e) => {
                                            const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                            current[idx].token = e.target.value;
                                            handleConfigChange('whatsapp', 'secondaryPhones', current);
                                          }} />
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="flex justify-end mt-6">
                                <button className="btn btn--primary" onClick={() => setWizardStep(2)}>Continuar</button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {wizardStep === 2 && (
                    <div className="animation-fade-in">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="h3 m-0">Importar Contatos</h3>
                          <p className="t-sm t-muted mt-1">Carregue sua base de leads para iniciar o envio.</p>
                        </div>
                      </div>

                      <div className="card hover-card mb-6">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="h4 m-0">Upload de Planilha (CSV)</h4>
                          <a
                            href="data:text/csv;charset=utf-8,nome,telefone%0AJoao,5511999999999%0AMaria,5511888888888"
                            download="modelo_contatos.csv"
                            className="t-sm"
                            style={{ color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                          >
                            <Download size={14} /> Baixar Modelo Exemplo
                          </a>
                        </div>
                        <p className="t-sm t-muted mb-6">
                          A planilha deve conter obrigatoriamente as colunas <strong>nome</strong> e <strong>telefone</strong>. O sistema higieniza os números automaticamente.
                        </p>

                        <div className="form-group mb-6">
                          <div style={{ border: '2px dashed var(--border)', borderRadius: '12px', padding: '48px 24px', textAlign: 'center', background: 'var(--bg-secondary)', cursor: 'pointer', transition: 'all 0.3s', position: 'relative', overflow: 'hidden' }} className="upload-zone hover:border-primary">
                            <UploadCloud size={48} style={{ color: 'var(--primary)', marginBottom: '16px', opacity: 0.8 }} />
                            <h5 className="h5 mb-2">Clique ou arraste seu arquivo CSV aqui</h5>
                            <p className="t-sm t-muted m-0">Tamanho máximo suportado: 5MB</p>
                            <input type="file" accept=".csv" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} id="csv-upload" onChange={handleCSVUpload} />
                          </div>
                        </div>

                        {csvStatus && (
                          <div className={`alert alert--${csvStatus.type === 'error' ? 'danger' : 'success'} mb-6 flex items-center gap-3`} style={{ borderRadius: '8px' }}>
                            {csvStatus.type === 'success' ? <CheckCircle2 size={18} /> : <Activity size={18} />}
                            {csvStatus.message}
                          </div>
                        )}

                        {wizardContacts.length > 0 && (
                          <div className="mb-2 animation-fade-in">
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="h5 m-0" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Users size={16} style={{ color: 'var(--primary)' }} /> Pré-visualização ({wizardContacts.length} contatos)
                              </h5>
                            </div>
                            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--card)' }}>
                              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1, borderBottom: '2px solid var(--border)' }}>
                                  <tr>
                                    <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--muted-foreground)' }}>Nome</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--muted-foreground)' }}>Telefone (Sanitizado)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {wizardContacts.slice(0, 10).map((c, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} className="hover:bg-secondary/50">
                                      <td style={{ padding: '14px 16px', fontSize: '14px', fontWeight: 500, color: 'var(--foreground)' }}>{c.nome}</td>
                                      <td style={{ padding: '14px 16px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--muted-foreground)' }}>+{c.telefone}</td>
                                    </tr>
                                  ))}
                                  {wizardContacts.length > 10 && (
                                    <tr>
                                      <td colSpan={2} style={{ padding: '16px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px', background: 'var(--bg-secondary)' }}>
                                        E mais {wizardContacts.length - 10} contatos ocultos na pré-visualização...
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between items-center pt-6 mt-6" style={{ borderTop: '1px solid var(--border)' }}>
                          <button className="btn btn--outline" onClick={() => setWizardStep(1)}>Voltar</button>
                          <button className="btn btn--primary" style={{ padding: '10px 24px' }} onClick={() => setWizardStep(3)}>Continuar para Mensagem</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {wizardStep === 3 && (
                    <div className="animation-fade-in">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="h3 m-0">Mensagem e Templates</h3>
                          <p className="t-sm t-muted mt-1">Selecione o template oficial da Meta para o disparo.</p>
                        </div>
                      </div>

                      <div className="card hover-card mb-6">
                        <div className="flex items-center gap-3 mb-4">
                          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--accent)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <LayoutTemplate size={18} />
                          </div>
                          <h4 className="h4 m-0">Template Principal</h4>
                        </div>

                        {wizardProvider === 'meta' ? (
                          <>
                            <div className="form-group mb-6" style={{ background: 'var(--bg-secondary)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                              <div className="flex justify-between items-center mb-4">
                                <div>
                                  <label className="label m-0" style={{ fontWeight: 600, fontSize: '15px' }}>Template Selecionado</label>
                                  <p className="t-sm t-muted m-0 mt-1">Este será o conteúdo enviado para a sua base de leads.</p>
                                </div>
                                <button
                                  className="btn btn--outline"
                                  style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                                  onClick={() => {
                                    const acc = fbPhoneAccounts.find(a => a.id === activeLogic.config.whatsapp.phoneId);
                                    if (acc && acc.wabaId) {
                                      setSelectedWabaForTemplates({ id: acc.wabaId, name: acc.wabaName });
                                    } else if (!activeLogic.config.whatsapp.phoneId) {
                                      alert('Você precisa selecionar o Número Principal no Passo 1 (Conexão) primeiro.');
                                      setWizardStep(1);
                                    } else {
                                      alert('Não foi possível identificar a conta de WhatsApp (WABA) atrelada a este número. Tente reconectar o Meta na aba de integrações.');
                                    }
                                  }}
                                >
                                  <LayoutTemplate size={16} /> Selecionar do Gerenciador
                                </button>
                              </div>

                              <div style={{ position: 'relative' }}>
                                <input
                                  type="text"
                                  className="input"
                                  value={activeLogic.config.whatsapp.templateName || ''}
                                  readOnly
                                  style={{ background: 'var(--card)', cursor: 'not-allowed', color: activeLogic.config.whatsapp.templateName ? 'var(--foreground)' : 'var(--muted-foreground)', fontSize: '16px', padding: '16px', fontWeight: activeLogic.config.whatsapp.templateName ? 600 : 400, border: activeLogic.config.whatsapp.templateName ? '2px solid var(--primary)' : '1px solid var(--border)' }}
                                  placeholder="Nenhum template selecionado. Clique no botão ao lado."
                                />
                                {activeLogic.config.whatsapp.templateName && (
                                  <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary)', display: 'flex', alignItems: 'center' }}>
                                    <CheckCircle2 size={20} />
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
                              <div className="flex justify-between items-center mb-4">
                                <div>
                                  <h5 className="h5 m-0 flex items-center gap-2"><Shuffle size={16} style={{ color: 'var(--primary)' }} /> Teste A/B (Variações)</h5>
                                  <p className="t-sm t-muted m-0 mt-1">Adicione templates alternativos para contornar bloqueios por repetição.</p>
                                </div>
                                <button className="btn btn--outline btn--sm" style={{ padding: '8px 16px', fontWeight: 600 }} onClick={() => {
                                  const current = activeLogic.config.whatsapp.secondaryTemplates || [];
                                  handleConfigChange('whatsapp', 'secondaryTemplates', [...current, '']);
                                }}>
                                  <Plus size={16} style={{ marginRight: '6px' }} /> Nova Variação
                                </button>
                              </div>

                              {(!activeLogic.config.whatsapp.secondaryTemplates || activeLogic.config.whatsapp.secondaryTemplates.length === 0) ? (
                                <div style={{ padding: '24px', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px dashed var(--border)' }}>
                                  <p className="t-sm t-muted m-0">O Teste A/B está inativo. Todos os disparos usarão apenas o template principal.</p>
                                </div>
                              ) : (
                                <div className="grid-2 gap-4">
                                  {activeLogic.config.whatsapp.secondaryTemplates?.map((tplName: string, idx: number) => (
                                    <div key={idx} className="form-group mb-0 p-4 animation-fade-in hover-card" style={{ background: 'var(--card)', borderRadius: '12px', border: '1px solid var(--border)', position: 'relative' }}>
                                      <button
                                        style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'all 0.2s' }}
                                        className="hover:bg-red-500/10 hover:text-red-500"
                                        onClick={() => {
                                          const current = [...activeLogic.config.whatsapp.secondaryTemplates];
                                          current.splice(idx, 1);
                                          handleConfigChange('whatsapp', 'secondaryTemplates', current);
                                        }}
                                      >
                                        <X size={16} />
                                      </button>

                                      <label className="label mb-3" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary)' }}>Variação {idx + 1}</label>

                                      <div className="flex flex-col gap-3">
                                        <input type="text" className="input" value={tplName} readOnly placeholder="Nenhum template..." style={{ flex: 1, background: 'var(--bg-secondary)', cursor: 'not-allowed', fontSize: '14px' }} />
                                        <button className="btn btn--outline btn--sm w-full" style={{ justifyContent: 'center' }} onClick={() => {
                                          const acc = fbPhoneAccounts.find(a => a.id === activeLogic.config.whatsapp.phoneId);
                                          if (acc && acc.wabaId) {
                                            setSelectedWabaForTemplates({ id: acc.wabaId, name: acc.wabaName, targetIndex: idx });
                                          } else {
                                            alert('Conta de WhatsApp não identificada. Volte no passo 1 e reconecte.');
                                          }
                                        }}>
                                          <LayoutTemplate size={14} /> Escolher Template
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="alert alert--info mb-4" style={{ borderRadius: '8px' }}>
                            <div className="flex items-center gap-3">
                              <Activity size={20} />
                              <div>
                                <strong>Aviso:</strong> O provedor selecionado não suporta envio de templates pré-aprovados da Meta.
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between items-center pt-6 mt-8" style={{ borderTop: '1px solid var(--border)' }}>
                          <button className="btn btn--outline" onClick={() => setWizardStep(2)}>Voltar</button>
                          <button className="btn btn--primary" onClick={() => setWizardStep(4)}>Ajustar Ritmo de Envio <ChevronDown size={16} style={{ transform: 'rotate(-90deg)', marginLeft: '8px' }} /></button>
                        </div>
                      </div>
                    </div>
                  )}

                  {wizardStep === 4 && (
                    <div className="animation-fade-in">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="h3 m-0">Ajustes Finais de Disparo</h3>
                          <p className="t-sm t-muted mt-1">Configure o ritmo e o agendamento da sua campanha.</p>
                        </div>
                      </div>

                      <div className="grid-2 gap-6 mb-6">
                        {/* Ritmo de Envio */}
                        <div className="card hover-card" style={{ display: 'flex', flexDirection: 'column' }}>
                          <div className="flex items-center gap-3 mb-4">
                            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--accent)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Timer size={18} />
                            </div>
                            <h4 className="h4 m-0">Ritmo de Envio</h4>
                          </div>
                          <p className="t-sm t-muted mb-6" style={{ flex: 1 }}>Evite bloqueios no WhatsApp configurando um intervalo seguro entre cada mensagem disparada. O padrão recomendado é 20 segundos.</p>

                          <div className="form-group mb-0" style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <div className="flex items-center justify-between mb-2">
                              <label className="label m-0" style={{ fontWeight: 600 }}>Intervalo (segundos)</label>
                              <span className="t-xs" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>Padrão: 20s</span>
                            </div>
                            <input
                              type="number"
                              className="input"
                              value={activeLogic.config.whatsapp.delayBetweenLeads ?? 20}
                              onChange={(e) => handleConfigChange('whatsapp', 'delayBetweenLeads', parseInt(e.target.value) || 20)}
                              style={{ fontSize: '18px', fontWeight: 'bold', background: 'var(--card)' }}
                            />
                          </div>
                        </div>

                        {/* Randomização */}
                        <div className="card hover-card" style={{ display: 'flex', flexDirection: 'column' }}>
                          <div className="flex items-center gap-3 mb-4">
                            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--accent)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Shuffle size={18} />
                            </div>
                            <h4 className="h4 m-0">Revezamento (Testes A/B)</h4>
                          </div>
                          <p className="t-sm t-muted mb-6" style={{ flex: 1 }}>Distribua a carga de disparos ativando o rodízio caso tenha adicionado variações nos passos anteriores.</p>

                          <div className="flex flex-col gap-3">
                            <label className="flex items-center justify-between p-3" style={{ background: 'var(--card)', borderRadius: '8px', cursor: (activeLogic.config.whatsapp.secondaryPhones?.length > 0) ? 'pointer' : 'not-allowed', opacity: (activeLogic.config.whatsapp.secondaryPhones?.length > 0) ? 1 : 0.5, border: '1px solid var(--border)', transition: 'border-color 0.2s' }}>
                              <div className="flex items-center gap-3">
                                <div style={{ color: activeLogic.config.whatsapp.randomizeNumbers ? 'var(--primary)' : 'var(--muted-foreground)' }}><Smartphone size={16} /></div>
                                <div>
                                  <span className="t-sm" style={{ fontWeight: 600, display: 'block', color: 'var(--foreground)' }}>Números de Telefone</span>
                                  <span className="t-xs t-muted">{activeLogic.config.whatsapp.secondaryPhones?.length || 0} adicionais</span>
                                </div>
                              </div>
                              <input type="checkbox" disabled={!activeLogic.config.whatsapp.secondaryPhones?.length} checked={activeLogic.config.whatsapp.randomizeNumbers} onChange={(e) => handleConfigChange('whatsapp', 'randomizeNumbers', e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }} />
                            </label>

                            <label className="flex items-center justify-between p-3" style={{ background: 'var(--card)', borderRadius: '8px', cursor: (activeLogic.config.whatsapp.secondaryTemplates?.length > 0) ? 'pointer' : 'not-allowed', opacity: (activeLogic.config.whatsapp.secondaryTemplates?.length > 0) ? 1 : 0.5, border: '1px solid var(--border)', transition: 'border-color 0.2s' }}>
                              <div className="flex items-center gap-3">
                                <div style={{ color: activeLogic.config.whatsapp.randomizeTemplates ? 'var(--primary)' : 'var(--muted-foreground)' }}><MessageSquare size={16} /></div>
                                <div>
                                  <span className="t-sm" style={{ fontWeight: 600, display: 'block', color: 'var(--foreground)' }}>Templates de Mensagem</span>
                                  <span className="t-xs t-muted">{activeLogic.config.whatsapp.secondaryTemplates?.length || 0} adicionais</span>
                                </div>
                              </div>
                              <input type="checkbox" disabled={!activeLogic.config.whatsapp.secondaryTemplates?.length} checked={activeLogic.config.whatsapp.randomizeTemplates} onChange={(e) => handleConfigChange('whatsapp', 'randomizeTemplates', e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }} />
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Agendamento */}
                      <div className="card mb-6" style={{ border: activeLogic.config.cron?.enabled ? '2px solid var(--primary)' : '1px solid var(--border)', transition: 'all 0.3s ease', background: activeLogic.config.cron?.enabled ? 'var(--accent)' : 'var(--card)' }}>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: activeLogic.config.cron?.enabled ? 'var(--primary)' : 'var(--bg-secondary)', color: activeLogic.config.cron?.enabled ? 'var(--primary-foreground)' : 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.3s' }}>
                              <CalendarClock size={20} />
                            </div>
                            <div>
                              <h4 className="h4 m-0" style={{ color: activeLogic.config.cron?.enabled ? 'var(--primary)' : 'var(--foreground)' }}>Agendamento Automático (Piloto Automático)</h4>
                              <p className="t-sm t-muted m-0 mt-1">Deixe o robô rodar em segundo plano e disparar sozinho, respeitando seus horários de atendimento.</p>
                            </div>
                          </div>
                          <button
                            className={`btn ${activeLogic.config.cron?.enabled ? 'btn--primary' : 'btn--outline'}`}
                            style={{ padding: '8px 16px' }}
                            onClick={() => handleConfigChange('cron', 'enabled', !activeLogic.config.cron?.enabled)}
                          >
                            {activeLogic.config.cron?.enabled ? 'Ativado' : 'Ativar Piloto Automático'}
                          </button>
                        </div>

                        {activeLogic.config.cron?.enabled && (
                          <div className="animation-fade-in p-5 mt-4" style={{ background: 'var(--card)', borderRadius: '12px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                            <div className="form-group mb-5">
                              <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Quais dias da semana ele pode disparar?</label>
                              <div className="flex gap-2 flex-wrap mt-3">
                                {[{ id: '0', label: 'Dom' }, { id: '1', label: 'Seg' }, { id: '2', label: 'Ter' }, { id: '3', label: 'Qua' }, { id: '4', label: 'Qui' }, { id: '5', label: 'Sex' }, { id: '6', label: 'Sáb' }].map(day => {
                                  const isSelected = (activeLogic.config.cron?.days || []).includes(day.id);
                                  return (
                                    <label key={day.id} className="flex items-center gap-1" style={{ background: isSelected ? 'var(--primary)' : 'var(--bg-secondary)', color: isSelected ? 'var(--primary-foreground)' : 'var(--muted-foreground)', padding: '8px 16px', borderRadius: '8px', border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`, fontSize: '13px', fontWeight: isSelected ? 600 : 500, cursor: 'pointer', transition: 'all 0.2s', boxShadow: isSelected ? '0 2px 8px rgba(245, 158, 11, 0.2)' : 'none' }}>
                                      <input type="checkbox" style={{ display: 'none' }} checked={isSelected} onChange={(e) => {
                                        let days = [...(activeLogic.config.cron?.days || [])];
                                        if (e.target.checked) days.push(day.id);
                                        else days = days.filter(d => d !== day.id);
                                        handleConfigChange('cron', 'days', days);
                                      }} />
                                      {day.label}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="grid-2 gap-6">
                              <div className="form-group mb-0">
                                <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Horário de Início</label>
                                <input type="time" className="input" style={{ fontSize: '16px', padding: '12px' }} value={activeLogic.config.cron?.startTime || '09:00'} onChange={(e) => handleConfigChange('cron', 'startTime', e.target.value)} />
                              </div>
                              <div className="form-group mb-0">
                                <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Horário de Fim</label>
                                <input type="time" className="input" style={{ fontSize: '16px', padding: '12px' }} value={activeLogic.config.cron?.endTime || '18:59'} onChange={(e) => handleConfigChange('cron', 'endTime', e.target.value)} />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-between items-center pt-6 mt-4" style={{ borderTop: '1px solid var(--border)' }}>
                        <button className="btn btn--outline" onClick={() => setWizardStep(3)}>Voltar</button>
                        <button className="btn btn--primary" onClick={() => setWizardStep(5)}>Revisar Campanha <ChevronDown size={16} style={{ transform: 'rotate(-90deg)', marginLeft: '8px' }} /></button>
                      </div>
                    </div>
                  )}

                  {wizardStep === 5 && (
                    <div className="animation-fade-in">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="h3 m-0">Revisão e Lançamento</h3>
                          <p className="t-sm t-muted mt-1">Verifique as parametrizações da sua campanha antes de dar o play.</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--accent)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--primary)', color: 'var(--primary)' }}>
                          <Rocket size={18} />
                          <span className="t-sm" style={{ fontWeight: 600 }}>Pronto para Disparo</span>
                        </div>
                      </div>

                      <div className="grid-2 gap-4 mb-6">
                        {/* Bloco 1: Conexão e Números */}
                        <div className="card hover-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div className="flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <MessageCircle size={16} />
                            </div>
                            <h5 className="h5 m-0">Canal e Remetentes</h5>
                          </div>

                          <div className="flex flex-col gap-4">
                            <div>
                              <span className="t-xs t-muted uppercase" style={{ fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: '4px' }}>Plataforma Selecionada</span>
                              <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--foreground)' }}>
                                {wizardProvider === 'meta' ? 'API Oficial da Meta (WhatsApp)' : 'Outra API'}
                              </span>
                            </div>
                            <div>
                              <span className="t-xs t-muted uppercase" style={{ fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: '4px' }}>Contas Ativas</span>
                              <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--primary)' }}>
                                {activeLogic.config.whatsapp.randomizeNumbers && activeLogic.config.whatsapp.secondaryPhones?.length > 0 ? (
                                  `Principal + ${activeLogic.config.whatsapp.secondaryPhones.length} Adicionais (Revezamento)`
                                ) : (
                                  'Apenas 1 Conta Principal'
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Bloco 2: Contatos */}
                        <div className="card hover-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div className="flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Users size={16} />
                            </div>
                            <h5 className="h5 m-0">Base de Destinatários</h5>
                          </div>

                          <div className="flex flex-col gap-4" style={{ flex: 1, justifyContent: 'center' }}>
                            <div style={{ textAlign: 'center' }}>
                              <span style={{ fontSize: '36px', fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{wizardContacts.length}</span>
                              <span className="t-sm t-muted" style={{ display: 'block', marginTop: '8px', fontWeight: 500 }}>contatos carregados e validados para recebimento.</span>
                            </div>
                          </div>
                        </div>

                        {/* Bloco 3: Mensagem */}
                        <div className="card hover-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div className="flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <LayoutTemplate size={16} />
                            </div>
                            <h5 className="h5 m-0">Composição da Mensagem</h5>
                          </div>

                          <div className="flex flex-col gap-4">
                            <div>
                              <span className="t-xs t-muted uppercase" style={{ fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: '4px' }}>Template Principal</span>
                              <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--foreground)', background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', border: '1px dashed var(--border)' }}>
                                {activeLogic.config.whatsapp.templateName || 'Nenhum selecionado'}
                              </span>
                            </div>
                            <div>
                              <span className="t-xs t-muted uppercase" style={{ fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: '4px' }}>Teste A/B (Variações)</span>
                              <span style={{ fontWeight: 600, fontSize: '15px', color: activeLogic.config.whatsapp.randomizeTemplates && activeLogic.config.whatsapp.secondaryTemplates?.length > 0 ? 'var(--primary)' : 'var(--muted-foreground)' }}>
                                {activeLogic.config.whatsapp.randomizeTemplates && activeLogic.config.whatsapp.secondaryTemplates?.length > 0 ? (
                                  `${activeLogic.config.whatsapp.secondaryTemplates.length} templates adicionais em rodízio`
                                ) : (
                                  'Desativado'
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Bloco 4: Ritmo e Cron */}
                        <div className="card hover-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div className="flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Timer size={16} />
                            </div>
                            <h5 className="h5 m-0">Execução e Agendamento</h5>
                          </div>

                          <div className="flex flex-col gap-4">
                            <div>
                              <span className="t-xs t-muted uppercase" style={{ fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: '4px' }}>Intervalo Seguro</span>
                              <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--foreground)' }}>
                                {activeLogic.config.whatsapp.delayBetweenLeads || 20} segundos por envio
                              </span>
                            </div>
                            <div>
                              <span className="t-xs t-muted uppercase" style={{ fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: '4px' }}>Modo de Operação</span>
                              <span style={{ fontWeight: 600, fontSize: '15px', color: activeLogic.config.cron?.enabled ? 'var(--primary)' : 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {activeLogic.config.cron?.enabled ? (
                                  <><CalendarClock size={16} /> Piloto Automático: {activeLogic.config.cron.startTime} às {activeLogic.config.cron.endTime}</>
                                ) : (
                                  <><Play size={16} /> Disparo Imediato (Manual)</>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-8 pt-6 flex justify-between items-center gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                        <button className="btn btn--outline" onClick={() => setWizardStep(4)} disabled={isExecuting}>Voltar</button>
                        {isExecuting ? (
                          <button className="btn btn--primary" onClick={handleStop} style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}>
                            <Activity size={16} /> Parar Execução
                          </button>
                        ) : (
                          <button className="btn btn--primary" onClick={runDisparo} disabled={isExecuting}>
                            <Play size={16} /> Iniciar Disparo
                          </button>
                        )}
                      </div>

                      {executionLogs.length > 0 && (
                        <div className="card" style={{ background: '#1e1e1e', color: '#fff', padding: '16px', border: '1px solid #333' }}>
                          <div className="flex justify-between items-center mb-4">
                            <h5 className="m-0" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Activity size={16} className={isExecuting ? "spin-animation" : ""} /> Terminal de Execução
                            </h5>
                            <button onClick={() => setExecutionLogs([])} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '12px' }}>Limpar Terminal</button>
                          </div>
                          <div style={{ maxHeight: '250px', overflowY: 'auto', fontSize: '13px', fontFamily: '"Fira Code", monospace', paddingRight: '8px' }}>
                            {executionLogs.slice().reverse().map((log, idx) => (
                              <div key={idx} style={{ marginBottom: '8px', color: log.type === 'error' ? '#ff6b6b' : log.type === 'success' ? '#51cf66' : '#a5d8ff', borderBottom: '1px solid #333', paddingBottom: '4px' }}>
                                <span style={{ color: '#666', marginRight: '8px' }}>[{log.timestamp || new Date().toLocaleTimeString()}]</span>
                                {log.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {currentView === 'logic' && (
            <>
              <div className="topbar">
                <div className="topbar__left" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 className="h3 m-0" style={{ margin: 0 }}>Configuração do Disparo</h3>
                </div>
                <div className="topbar__right">
                  {executionLogs.length > 0 && (
                    <button className="btn btn--outline" onClick={() => setShowLogModal(true)} style={{ color: isExecuting ? '#10b981' : 'inherit', borderColor: isExecuting ? '#10b981' : 'var(--border)' }}>
                      <MessageSquare size={16} /> Ver Logs {isExecuting ? '(Ao Vivo)' : ''}
                    </button>
                  )}
                  <button className="btn btn--outline" onClick={handleSave}><Save size={16} /> Salvar Configuração</button>
                  {isExecuting ? (
                    <button className="btn btn--primary" onClick={handleStop} style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}>
                      <Activity size={16} /> Parar Execução
                    </button>
                  ) : (
                    <button className="btn btn--primary" onClick={runDisparo} disabled={isExecuting}>
                      <Play size={16} /> Executar Agora
                    </button>
                  )}
                </div>
              </div>

              <div className="main-content">
                <div className="content-wrapper">
                  <div className="page-header">
                    <div className="page-header__greeting">Configuração Dinâmica</div>
                    <div className="page-header__title">Construa o Fluxo de Disparo</div>
                    <div className="page-header__subtitle">Habilite e preencha as configurações para cada módulo da sua integração.</div>
                  </div>

                  <div className="grid-2 mb-6">
                    <div className={`card ${activeLogic.config.googleSheets.enabled ? 'card--brand' : ''}`}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div style={{ backgroundColor: '#e5f3e8', padding: '8px', borderRadius: '8px', color: '#0f9d58' }}>
                            <Database size={24} />
                          </div>
                          <div>
                            <h4 className="h4" style={{ margin: 0 }}>Google Sheets</h4>
                          </div>
                        </div>
                        <input type="checkbox" checked={activeLogic.config.googleSheets.enabled} onChange={(e) => handleConfigChange('googleSheets', 'enabled', e.target.checked)} />
                      </div>
                      {activeLogic.config.googleSheets.enabled && (
                        <>
                          <div className="form-group mb-4">
                            <label className="label">ID da Planilha</label>
                            <input type="text" className="input" placeholder="ID da URL" value={activeLogic.config.googleSheets.sheetId} onChange={(e) => handleConfigChange('googleSheets', 'sheetId', e.target.value)} />
                          </div>
                          <div className="form-group mb-4">
                            <label className="label">Nome da Aba (Sheet Name)</label>
                            <input type="text" className="input" value={activeLogic.config.googleSheets.sheetName} onChange={(e) => handleConfigChange('googleSheets', 'sheetName', e.target.value)} />
                          </div>

                          <button
                            className="btn btn--outline mb-4"
                            onClick={loadColumns}
                            disabled={isLoadingColumns || !activeLogic.config.googleSheets.sheetId}
                          >
                            {isLoadingColumns ? 'Carregando...' : 'Buscar Colunas da Planilha'}
                          </button>

                          <div className="form-group mb-4">
                            <label className="label">Coluna para Gravar Timestamp (Controle de Envio)</label>
                            {sheetColumns.length > 0 ? (
                              <select className="select" value={activeLogic.config.googleSheets.filterColumn} onChange={(e) => handleConfigChange('googleSheets', 'filterColumn', e.target.value)}>
                                <option value="">Selecione a coluna...</option>
                                {sheetColumns.map(col => <option key={col} value={col}>{col}</option>)}
                              </select>
                            ) : (
                              <input type="text" className="input" placeholder="Ex: envio1" value={activeLogic.config.googleSheets.filterColumn} onChange={(e) => handleConfigChange('googleSheets', 'filterColumn', e.target.value)} />
                            )}
                          </div>

                          <div className="form-group mb-4">
                            <label className="label">Limite de Linhas a Processar</label>
                            <input type="number" className="input" placeholder="Ex: 50" value={activeLogic.config.googleSheets.limitRows || ''} onChange={(e) => handleConfigChange('googleSheets', 'limitRows', parseInt(e.target.value) || 0)} />
                            <p className="t-xs t-muted mt-1">Deixe 50 para disparo padrão, ou mude para 2, 5, etc para fazer testes curtos.</p>

                            <label className="flex items-center gap-2 mt-3" style={{ cursor: 'pointer', fontWeight: 600 }}>
                              <input type="checkbox" checked={activeLogic.config.googleSheets.respectCronTime !== false} onChange={(e) => handleConfigChange('googleSheets', 'respectCronTime', e.target.checked)} />
                              Respeitar janela de horário do Cron (Pausar no Horário de Fim)
                            </label>
                          </div>

                          <div className="mt-4" style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px' }}>
                            <div className="flex items-center justify-between mb-3">
                              <label className="label m-0" style={{ fontWeight: 600 }}>Filtros de Leitura</label>
                              <button className="btn btn--sm btn--outline" onClick={handleAddFilter}><Plus size={14} /> Adicionar</button>
                            </div>

                            {(!activeLogic.config.googleSheets.filters || activeLogic.config.googleSheets.filters.length === 0) && (
                              <p className="t-xs t-muted">Nenhum filtro aplicado. Todas as linhas serão lidas.</p>
                            )}

                            <div className="flex flex-col gap-3">
                              {activeLogic.config.googleSheets.filters?.map((filter: any) => (
                                <div key={filter.id} className="flex items-end gap-2">
                                  <div className="form-group" style={{ flex: 1 }}>
                                    <label className="label" style={{ fontSize: '11px' }}>Coluna</label>
                                    {sheetColumns.length > 0 ? (
                                      <select className="select" value={filter.column} onChange={(e) => handleFilterChange(filter.id, 'column', e.target.value)}>
                                        <option value="">Selecione...</option>
                                        {sheetColumns.map(col => <option key={col} value={col}>{col}</option>)}
                                      </select>
                                    ) : (
                                      <input type="text" className="input" placeholder="Ex: status" value={filter.column} onChange={(e) => handleFilterChange(filter.id, 'column', e.target.value)} />
                                    )}
                                  </div>
                                  <div className="form-group" style={{ width: '120px' }}>
                                    <label className="label" style={{ fontSize: '11px' }}>Condição</label>
                                    <select className="select" value={filter.operator} onChange={(e) => handleFilterChange(filter.id, 'operator', e.target.value)}>
                                      <option value="empty">É Vazio</option>
                                      <option value="not_empty">Não é Vazio</option>
                                      <option value="equals">Igual a</option>
                                      <option value="not_equals">Diferente de</option>
                                    </select>
                                  </div>
                                  {(filter.operator === 'equals' || filter.operator === 'not_equals') && (
                                    <div className="form-group" style={{ flex: 1 }}>
                                      <label className="label" style={{ fontSize: '11px' }}>Valor</label>
                                      <input type="text" className="input" placeholder="Valor" value={filter.value} onChange={(e) => handleFilterChange(filter.id, 'value', e.target.value)} />
                                    </div>
                                  )}
                                  <button className="btn btn--icon btn--danger" style={{ height: '40px', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }} onClick={() => handleRemoveFilter(filter.id)}>
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="mt-4" style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px' }}>
                            <div className="form-group mb-3">
                              <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontWeight: 600 }}>
                                <input type="checkbox" checked={activeLogic.config.googleSheets.followUpEnabled} onChange={(e) => handleConfigChange('googleSheets', 'followUpEnabled', e.target.checked)} />
                                Habilitar regra de Follow-up (Intervalo de tempo)
                              </label>
                              <p className="t-xs t-muted mt-1">Só dispara se a data na planilha for mais antiga que a quantidade de horas configurada.</p>
                            </div>

                            {activeLogic.config.googleSheets.followUpEnabled && (
                              <div className="flex gap-4">
                                <div className="form-group" style={{ flex: 1 }}>
                                  <label className="label">Coluna de Data Base</label>
                                  {sheetColumns.length > 0 ? (
                                    <select className="select" value={activeLogic.config.googleSheets.followUpColumn || ''} onChange={(e) => handleConfigChange('googleSheets', 'followUpColumn', e.target.value)}>
                                      <option value="">Selecione a coluna...</option>
                                      {sheetColumns.map(col => <option key={col} value={col}>{col}</option>)}
                                    </select>
                                  ) : (
                                    <input type="text" className="input" placeholder="Ex: envio1" value={activeLogic.config.googleSheets.followUpColumn || ''} onChange={(e) => handleConfigChange('googleSheets', 'followUpColumn', e.target.value)} />
                                  )}
                                </div>
                                <div className="form-group" style={{ width: '150px' }}>
                                  <label className="label">Horas após envio</label>
                                  <input type="number" className="input" min="1" value={activeLogic.config.googleSheets.followUpHours || 48} onChange={(e) => handleConfigChange('googleSheets', 'followUpHours', parseInt(e.target.value))} />
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className={`card ${activeLogic.config.crm.enabled ? 'card--brand' : ''}`}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div style={{ backgroundColor: 'var(--v4-100)', padding: '8px', borderRadius: '8px', color: 'var(--v4-600)' }}>
                            <Activity size={24} />
                          </div>
                          <div>
                            <h4 className="h4" style={{ margin: 0 }}>CRM MKT Lab</h4>
                          </div>
                        </div>
                        <input type="checkbox" checked={activeLogic.config.crm.enabled} onChange={(e) => handleConfigChange('crm', 'enabled', e.target.checked)} />
                      </div>
                      {activeLogic.config.crm.enabled && (
                        <>
                          <div className="form-group mb-4">
                            <label className="label">API URL</label>
                            <input type="text" className="input" value={activeLogic.config.crm.apiUrl} onChange={(e) => handleConfigChange('crm', 'apiUrl', e.target.value)} />
                          </div>
                          <div className="form-group mb-4">
                            <label className="label">Token do CRM</label>
                            <input type="password" className="input" placeholder="Bearer Token" value={activeLogic.config.crm.token} onChange={(e) => handleConfigChange('crm', 'token', e.target.value)} />
                          </div>
                          <div className="form-group mb-4">
                            <label className="label">Stage ID para mover Deal</label>
                            <input type="text" className="input" value={activeLogic.config.crm.stageId} onChange={(e) => handleConfigChange('crm', 'stageId', e.target.value)} />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={`card mb-6 ${activeLogic.config.whatsapp.enabled ? 'card--brand' : ''}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div style={{ backgroundColor: '#e3f2fd', padding: '8px', borderRadius: '8px', color: '#1976d2' }}>
                          <MessageSquare size={24} />
                        </div>
                        <div>
                          <h4 className="h4" style={{ margin: 0 }}>WhatsApp (Meta Graph API)</h4>
                        </div>
                      </div>
                      <input type="checkbox" checked={activeLogic.config.whatsapp.enabled} onChange={(e) => handleConfigChange('whatsapp', 'enabled', e.target.checked)} />
                    </div>

                    {activeLogic.config.whatsapp.enabled && (
                      <>
                        <div className="mb-4" style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px' }}>
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="h5 m-0">Conexão Oficial com o Meta</h5>
                            {!isFbConnected ? (
                              <button onClick={handleFbLogin} className="btn btn--primary btn--sm" style={{ backgroundColor: '#1877F2', borderColor: '#1877F2' }} disabled={isLoadingFb}>
                                <span style={{ backgroundColor: '#fff', color: '#1877F2', padding: '2px 6px', borderRadius: '4px', marginRight: '6px', fontWeight: 'bold' }}>f</span> {isLoadingFb ? 'Carregando...' : 'Conectar Conta'}
                              </button>
                            ) : (
                              <span style={{ color: '#10b981', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <CheckCircle2 size={16} /> Conectado
                              </span>
                            )}
                          </div>

                          {isFbConnected && fbPhoneAccounts.length > 0 && (
                            <div className="form-group">
                              <label className="label">Selecione o Número Principal</label>
                              <select className="select" onChange={(e) => {
                                const selectedId = e.target.value;
                                if (selectedId) {
                                  handleConfigChange('whatsapp', 'phoneId', selectedId);
                                  const token = localStorage.getItem('fb_access_token');
                                  if (token) handleConfigChange('whatsapp', 'token', token);
                                }
                              }} value={activeLogic.config.whatsapp.phoneId}>
                                <option value="">-- Selecionar da minha conta Meta --</option>
                                {fbPhoneAccounts.map(acc => (
                                  <option key={acc.id} value={acc.id} disabled={activeLogic.config.whatsapp.secondaryPhones?.some((s: any) => s.phoneId === acc.id)}>
                                    {acc.verified_name || acc.display_phone_number} ({acc.display_phone_number}) - {acc.wabaName}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {(!isFbConnected || fbPhoneAccounts.length === 0) && (
                            <p className="t-xs t-muted m-0">Conecte sua conta do Facebook para listar seus números automaticamente, ou preencha manualmente abaixo.</p>
                          )}
                        </div>

                        <div className="form-group mb-4">
                          <label className="label">Phone ID Principal</label>
                          <input type="text" className="input" value={activeLogic.config.whatsapp.phoneId} onChange={(e) => handleConfigChange('whatsapp', 'phoneId', e.target.value)} />
                        </div>
                        <div className="form-group mb-4">
                          <label className="label">Access Token Principal</label>
                          <input type="password" className="input" value={activeLogic.config.whatsapp.token} onChange={(e) => handleConfigChange('whatsapp', 'token', e.target.value)} />
                        </div>

                        <div className="form-group mb-4">
                          <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontWeight: 600 }}>
                            <input type="checkbox" checked={activeLogic.config.whatsapp.randomizeNumbers} onChange={(e) => handleConfigChange('whatsapp', 'randomizeNumbers', e.target.checked)} />
                            Alternar envios com um segundo número (Randomizar)
                          </label>
                        </div>

                        {activeLogic.config.whatsapp.randomizeNumbers && (
                          <div style={{ padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px dashed var(--border)' }}>
                            <div className="flex justify-between items-center mb-4">
                              <h5 className="h5 m-0">Números Adicionais (Revezamento)</h5>
                              <button
                                className="btn btn--outline btn--sm"
                                onClick={() => {
                                  const current = activeLogic.config.whatsapp.secondaryPhones || [];
                                  handleConfigChange('whatsapp', 'secondaryPhones', [...current, { phoneId: '', token: '' }]);
                                }}
                              >
                                <Plus size={14} style={{ marginRight: '4px' }} /> Adicionar Número
                              </button>
                            </div>

                            {(!activeLogic.config.whatsapp.secondaryPhones || activeLogic.config.whatsapp.secondaryPhones.length === 0) && (
                              <p className="t-sm t-muted m-0 text-center py-4">Nenhum número adicional configurado. Adicione um para revezar os disparos.</p>
                            )}

                            {activeLogic.config.whatsapp.secondaryPhones?.map((sp: any, idx: number) => (
                              <div key={idx} style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', marginBottom: '12px', position: 'relative' }}>
                                <button
                                  style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                                  onClick={() => {
                                    const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                    current.splice(idx, 1);
                                    handleConfigChange('whatsapp', 'secondaryPhones', current);
                                  }}
                                >
                                  &times;
                                </button>

                                <h6 className="m-0 mb-3" style={{ fontSize: '13px' }}>Número Secundário {idx + 1}</h6>

                                {fbPhoneAccounts.length > 0 && (
                                  <div className="form-group mb-3">
                                    <label className="label">Selecionar Conta (Auto-preencher)</label>
                                    <select className="select" onChange={(e) => {
                                      const selectedId = e.target.value;
                                      if (selectedId) {
                                        const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                        current[idx].phoneId = selectedId;
                                        const token = localStorage.getItem('fb_access_token');
                                        if (token) current[idx].token = token;
                                        handleConfigChange('whatsapp', 'secondaryPhones', current);
                                      }
                                    }} value={sp.phoneId}>
                                      <option value="">-- Selecionar da lista --</option>
                                      {fbPhoneAccounts.map(acc => (
                                        <option key={acc.id} value={acc.id} disabled={activeLogic.config.whatsapp.phoneId === acc.id || activeLogic.config.whatsapp.secondaryPhones?.some((s: any, i: number) => i !== idx && s.phoneId === acc.id)}>
                                          {acc.verified_name || acc.display_phone_number} ({acc.display_phone_number})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}

                                <div className="grid-2">
                                  <div className="form-group">
                                    <label className="label">Phone ID</label>
                                    <input type="text" className="input" value={sp.phoneId} onChange={(e) => {
                                      const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                      current[idx].phoneId = e.target.value;
                                      handleConfigChange('whatsapp', 'secondaryPhones', current);
                                    }} />
                                  </div>
                                  <div className="form-group">
                                    <label className="label">Access Token</label>
                                    <input type="password" className="input" value={sp.token} onChange={(e) => {
                                      const current = [...activeLogic.config.whatsapp.secondaryPhones];
                                      current[idx].token = e.target.value;
                                      handleConfigChange('whatsapp', 'secondaryPhones', current);
                                    }} />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="form-group mb-4">
                          <div className="flex justify-between items-center mb-1">
                            <label className="label m-0">Nome do Template</label>
                            <button
                              className="btn btn--outline btn--sm"
                              style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => {
                                const acc = fbPhoneAccounts.find(a => a.id === activeLogic.config.whatsapp.phoneId);
                                if (acc && acc.wabaId) {
                                  setSelectedWabaForTemplates({ id: acc.wabaId, name: acc.wabaName });
                                } else if (!activeLogic.config.whatsapp.phoneId) {
                                  alert('Selecione um número na lista oficial do Meta primeiro!');
                                } else {
                                  alert('Não foi possível identificar a conta de WhatsApp (WABA) atrelada a este número. Tente reconectar.');
                                }
                              }}
                            >
                              <LayoutTemplate size={12} /> Gerenciar Templates
                            </button>
                          </div>
                          <input type="text" className="input" value={activeLogic.config.whatsapp.templateName || ''} readOnly placeholder="Nenhum template selecionado" style={{ background: 'var(--bg-secondary)', cursor: 'not-allowed', color: 'var(--text-muted)' }} />
                        </div>

                        <div className="mt-4" style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px' }}>
                          <div className="flex items-center justify-between mb-3">
                            <label className="label m-0" style={{ fontWeight: 600 }}>Colunas de Telefone a Disparar (Por Lead)</label>
                            <button className="btn btn--sm btn--outline" onClick={() => {
                              const cols = [...(activeLogic.config.whatsapp.phoneColumns || [])];
                              cols.push('');
                              handleConfigChange('whatsapp', 'phoneColumns', cols);
                            }}><Plus size={14} /> Adicionar Coluna</button>
                          </div>

                          <div className="flex flex-col gap-3 mb-4">
                            {activeLogic.config.whatsapp.phoneColumns?.map((col: string, index: number) => (
                              <div key={index} className="flex items-end gap-2">
                                <div className="form-group" style={{ flex: 1 }}>
                                  {sheetColumns.length > 0 ? (
                                    <select className="select" value={col} onChange={(e) => {
                                      const cols = [...activeLogic.config.whatsapp.phoneColumns];
                                      cols[index] = e.target.value;
                                      handleConfigChange('whatsapp', 'phoneColumns', cols);
                                    }}>
                                      <option value="">Selecione...</option>
                                      {sheetColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  ) : (
                                    <input type="text" className="input" placeholder="Ex: Telefone 1" value={col} onChange={(e) => {
                                      const cols = [...activeLogic.config.whatsapp.phoneColumns];
                                      cols[index] = e.target.value;
                                      handleConfigChange('whatsapp', 'phoneColumns', cols);
                                    }} />
                                  )}
                                </div>
                                <button className="btn btn--icon btn--danger" style={{ height: '40px', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }} onClick={() => {
                                  const cols = [...activeLogic.config.whatsapp.phoneColumns];
                                  cols.splice(index, 1);
                                  handleConfigChange('whatsapp', 'phoneColumns', cols);
                                }}>✕</button>
                              </div>
                            ))}
                          </div>

                          <div className="grid-2">
                            <div className="form-group">
                              <label className="label">Atraso entre números do mesmo lead (seg)</label>
                              <input type="number" className="input" value={activeLogic.config.whatsapp.delayBetweenNumbers || 0} onChange={(e) => handleConfigChange('whatsapp', 'delayBetweenNumbers', parseInt(e.target.value))} />
                            </div>
                            <div className="form-group">
                              <label className="label">Atraso entre leads diferentes (seg)</label>
                              <input type="number" className="input" value={activeLogic.config.whatsapp.delayBetweenLeads || 0} onChange={(e) => handleConfigChange('whatsapp', 'delayBetweenLeads', parseInt(e.target.value))} />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className={`card mb-6 ${activeLogic.config.cron?.enabled ? 'card--brand' : ''}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div style={{ backgroundColor: '#f3e8ff', padding: '8px', borderRadius: '8px', color: '#9333ea' }}>
                          <Activity size={24} />
                        </div>
                        <div>
                          <h4 className="h4" style={{ margin: 0 }}>Agendamento Automático (CRON)</h4>
                        </div>
                      </div>
                      <input type="checkbox" checked={activeLogic.config.cron?.enabled} onChange={(e) => handleConfigChange('cron', 'enabled', e.target.checked)} />
                    </div>

                    {activeLogic.config.cron?.enabled && (
                      <>
                        <div className="form-group mb-4">
                          <label className="label">Dias da Semana</label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { val: '1', label: 'Seg' },
                              { val: '2', label: 'Ter' },
                              { val: '3', label: 'Qua' },
                              { val: '4', label: 'Qui' },
                              { val: '5', label: 'Sex' },
                              { val: '6', label: 'Sáb' },
                              { val: '0', label: 'Dom' }
                            ].map(day => (
                              <label key={day.val} className="flex items-center gap-1" style={{ background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={activeLogic.config.cron?.days?.includes(day.val) || false} onChange={(e) => {
                                  const days = [...(activeLogic.config.cron?.days || [])];
                                  if (e.target.checked) days.push(day.val);
                                  else days.splice(days.indexOf(day.val), 1);
                                  handleConfigChange('cron', 'days', days);
                                }} />
                                {day.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-4 mb-4">
                          <div className="form-group" style={{ flex: 1 }}>
                            <label className="label">Horário de Início</label>
                            <input type="time" className="input" value={activeLogic.config.cron?.startTime || '09:00'} onChange={(e) => handleConfigChange('cron', 'startTime', e.target.value)} />
                          </div>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label className="label">Horário de Fim (Pausa o disparo)</label>
                            <input type="time" className="input" value={activeLogic.config.cron?.endTime || '18:59'} onChange={(e) => handleConfigChange('cron', 'endTime', e.target.value)} />
                          </div>
                        </div>
                        <p className="t-xs t-muted m-0">Quando ativado, o sistema roda automaticamente a cada 2 minutos no servidor para verificar se precisa disparar, de acordo com os dias e horários acima.</p>
                      </>
                    )}
                  </div>

                  <h4 className="h4 mb-4">Últimas Execuções</h4>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Lógica</th>
                          <th>Planilha</th>
                          <th>Data</th>
                          <th>Status</th>
                          <th>Lotes</th>
                          <th>WhatsApp</th>
                          <th>CRM</th>
                          <th>Erros</th>
                          <th style={{ width: '40px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveExecution && (
                          <tr key="live" style={{ background: 'var(--bg-secondary)', borderLeft: '3px solid var(--primary)' }}>
                            <td>{liveExecution.logicName} <span className="badge badge--brand" style={{ marginLeft: '4px' }}>Ao Vivo</span></td>
                            <td><span className="badge" style={{ background: '#e2e8f0', color: '#475569' }}>{liveExecution.sheetName || 'N/A'}</span></td>
                            <td>{liveExecution.date}</td>
                            <td><span className="badge" style={{ background: '#bfdbfe', color: '#1d4ed8' }}><Activity size={12} /> {liveExecution.status}</span></td>
                            <td><span>{liveExecution.processed}</span> lidos</td>
                            <td><span style={{ color: '#10b981', fontWeight: 600 }}>{liveExecution.wpSent || 0}</span> enviados</td>
                            <td><span style={{ color: '#3b82f6', fontWeight: 600 }}>{liveExecution.crmUpdates || 0}</span> moves</td>
                            <td><span style={{ color: liveExecution.errors > 0 ? '#ef4444' : '#64748b', fontWeight: liveExecution.errors > 0 ? 600 : 400 }}>{liveExecution.errors || 0}</span> erros</td>
                            <td>
                              <button className="btn btn--outline" onClick={() => setDetailsModalData(liveExecution)} style={{ width: '32px', height: '32px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }} title="Ver detalhes">
                                <Search size={16} />
                              </button>
                            </td>
                          </tr>
                        )}
                        {history.length > 0 ? history.map(h => (
                          <tr key={h.id}>
                            <td>{h.logicName}</td>
                            <td><span className="badge" style={{ background: '#e2e8f0', color: '#475569' }}>{h.sheetName || 'N/A'}</span></td>
                            <td>{h.date}</td>
                            <td><span className={`badge ${h.status === 'Com Erros' ? 'badge--error' : 'badge--success'}`}><CheckCircle2 size={12} /> {h.status}</span></td>
                            <td><span>{h.processed}</span> lidos</td>
                            <td><span style={{ color: '#10b981', fontWeight: 600 }}>{h.wpSent || 0}</span> enviados</td>
                            <td><span style={{ color: '#3b82f6', fontWeight: 600 }}>{h.crmUpdates || 0}</span> moves</td>
                            <td><span style={{ color: h.errors > 0 ? '#ef4444' : '#64748b', fontWeight: h.errors > 0 ? 600 : 400 }}>{h.errors || 0}</span> erros</td>
                            <td>
                              <button className="btn btn--outline" onClick={() => setDetailsModalData(h)} style={{ width: '32px', height: '32px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }} title="Ver detalhes">
                                <Search size={16} />
                              </button>
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={4} style={{ textAlign: 'center' }}>Nenhuma execução ainda.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* MODAL DE LOGS AO VIVO */}
      {showLogModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', width: '800px', maxWidth: '90%', borderRadius: '12px', padding: '24px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="h3 m-0">Log de Execução</h3>
              <div className="flex gap-2">
                <button className="btn btn--outline" onClick={() => setExecutionLogs([])} disabled={isExecuting}>Limpar</button>
                <button className="btn btn--outline" onClick={() => setShowLogModal(false)}>Fechar Janela</button>
              </div>
            </div>

            <div style={{ background: '#1e1e1e', color: '#00ff00', fontFamily: 'monospace', padding: '16px', borderRadius: '8px', overflowY: 'auto', flex: 1, fontSize: '13px' }}>
              {executionLogs.map((log, i) => (
                <div key={i} style={{ marginBottom: '4px', color: log.type === 'error' ? '#ff5252' : log.type === 'warn' ? '#ffeb3b' : log.type === 'success' ? '#4caf50' : log.type === 'done' ? '#2196f3' : '#00ff00' }}>
                  <span style={{ opacity: 0.5 }}>[{log.timestamp || new Date().toLocaleTimeString()}]</span> {log.message}
                </div>
              ))}
              {isExecuting && (
                <div style={{ marginTop: '8px', opacity: 0.5 }}>Aguardando processamento...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES DA EXECUÇÃO */}
      {detailsModalData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', width: '600px', maxWidth: '90%', borderRadius: '12px', padding: '24px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="h3 m-0">Detalhes da Execução</h3>
                <p className="t-sm t-muted m-0">{detailsModalData.date} • {detailsModalData.logicName}</p>
              </div>
              <button className="btn btn--outline" onClick={() => setDetailsModalData(null)}>Fechar</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              <h4 className="h4 mb-2">Linhas Processadas na Planilha ({detailsModalData.processedRows?.length || 0})</h4>
              <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', fontFamily: 'monospace' }}>
                {detailsModalData.processedRows?.length > 0 ? detailsModalData.processedRows.join(', ') : 'Nenhuma linha processada.'}
              </div>

              <h4 className="h4 mb-2">Números Destinatários ({detailsModalData.sentPhones?.length || 0})</h4>
              <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', whiteSpace: 'pre-line' }}>
                {detailsModalData.sentPhones?.length > 0 ? (
                  typeof detailsModalData.sentPhones[0] === 'string'
                    ? detailsModalData.sentPhones.join('\n')
                    : detailsModalData.sentPhones.map((d: any) => `Linha ${d.row}:\n  ${d.phones.join('\n  ')}`).join('\n\n')
                ) : 'Nenhum número enviado.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE TEMPLATES */}
      {selectedWabaForTemplates && (
        <TemplateManager
          wabaId={selectedWabaForTemplates.id}
          wabaName={selectedWabaForTemplates.name}
          accessToken={localStorage.getItem('fb_access_token') || ''}
          onClose={() => setSelectedWabaForTemplates(null)}
          onSelectTemplate={(name, hasVariables) => {
            const currentMap = { ...(activeLogic.config.whatsapp.templateVarsMap || {}) };
            currentMap[name] = hasVariables;
            handleConfigChange('whatsapp', 'templateVarsMap', currentMap);

            if (selectedWabaForTemplates.targetIndex !== undefined) {
              const current = [...(activeLogic.config.whatsapp.secondaryTemplates || [])];
              current[selectedWabaForTemplates.targetIndex] = name;
              handleConfigChange('whatsapp', 'secondaryTemplates', current);
            } else {
              handleConfigChange('whatsapp', 'templateName', name);
            }
            setSelectedWabaForTemplates(null);
          }}
        />
      )}
    </>
  );
}
