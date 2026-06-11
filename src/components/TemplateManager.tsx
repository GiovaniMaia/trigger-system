import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';

interface TemplateManagerProps {
  wabaId: string;
  wabaName: string;
  accessToken: string;
  onClose: () => void;
  onSelectTemplate: (name: string, hasVariables: boolean) => void;
}

export const TemplateManager: React.FC<TemplateManagerProps> = ({ wabaId, wabaName, accessToken, onClose, onSelectTemplate }) => {
  const [templates, setTemplates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Create mode state
  const [isCreating, setIsCreating] = useState(false);
  const [newTplName, setNewTplName] = useState('');
  const [newTplCategory, setNewTplCategory] = useState('MARKETING');
  const [newTplLanguage, setNewTplLanguage] = useState('pt_BR');
  const [newTplBody, setNewTplBody] = useState('');

  // Advanced Template Components
  const [newTplHeaderType, setNewTplHeaderType] = useState('NONE'); // NONE, TEXT, MEDIA
  const [newTplHeaderText, setNewTplHeaderText] = useState('');
  const [newTplFooterText, setNewTplFooterText] = useState('');
  const [newTplButtons, setNewTplButtons] = useState<any[]>([]);

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [wabaId]);

  const fetchTemplates = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100&access_token=${accessToken}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setTemplates(data.data || []);
    } catch (e: any) {
      setError('Erro ao carregar templates: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTplName || !newTplBody) {
      alert('Nome e texto da mensagem são obrigatórios.');
      return;
    }

    // Format name (lowercase, no spaces)
    const formattedName = newTplName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const components: any[] = [];

    // Header
    if (newTplHeaderType === 'TEXT' && newTplHeaderText) {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: newTplHeaderText
      });
    }

    // Body Variables Example
    const numVariablesMatch = newTplBody.match(/\{\{\d+\}\}/g);
    // Deduplicate variables (e.g. {{1}} and {{1}} counts as 1 variable)
    const uniqueVariables = numVariablesMatch ? Array.from(new Set(numVariablesMatch)) : [];
    const bodyExampleTexts: string[] = [];

    if (uniqueVariables.length > 0) {
      for (let i = 0; i < uniqueVariables.length; i++) {
        bodyExampleTexts.push(`Exemplo_${i + 1}`);
      }
    }

    components.push({
      type: 'BODY',
      text: newTplBody,
      ...(bodyExampleTexts.length > 0 ? { example: { body_text: [bodyExampleTexts] } } : {})
    });

    // Footer
    if (newTplFooterText) {
      components.push({
        type: 'FOOTER',
        text: newTplFooterText
      });
    }

    // Buttons
    if (newTplButtons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: newTplButtons.map(b => {
          if (b.type === 'URL') {
            return { type: 'URL', text: b.text, url: b.url };
          }
          return { type: 'QUICK_REPLY', text: b.text };
        })
      });
    }

    const payload = {
      name: formattedName,
      category: newTplCategory,
      language: newTplLanguage,
      components: components
    };

    setIsSaving(true);
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      alert('Template criado com sucesso! Ele entrará em análise pela Meta.');
      setIsCreating(false);
      fetchTemplates();
    } catch (e: any) {
      alert('Erro ao criar: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTemplate = async (name: string) => {
    if (!confirm(`Tem certeza que deseja apagar o template "${name}"?`)) return;

    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=${name}&access_token=${accessToken}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      fetchTemplates();
    } catch (e: any) {
      alert('Erro ao apagar: ' + e.message);
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="card animation-fade-in" style={{ width: '800px', maxWidth: '100%', borderRadius: '16px', padding: '32px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>

        <div className="flex items-center justify-between mb-6" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
          <div>
            <h3 className="h3 m-0">Gerenciador de Templates</h3>
            <p className="t-sm t-muted m-0 mt-1">Conta: <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{wabaName}</span></p>
          </div>
          <button className="btn btn--outline" onClick={onClose} style={{ padding: '8px', borderRadius: '50%' }}>
            <X size={20} />
          </button>
        </div>

        {error && <div className="alert alert--danger mb-6">{error}</div>}

        {!isCreating ? (
          <>
            <div className="flex justify-between items-center mb-6">
              <h4 className="h4 m-0">Templates Ativos</h4>
              <button className="btn btn--primary" onClick={() => setIsCreating(true)}>
                <Plus size={18} style={{ marginRight: '6px' }} /> Criar Novo Template
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '8px' }}>
              {isLoading ? (
                <div className="p-8 flex flex-col items-center justify-center gap-3" style={{ textAlign: 'center', color: 'var(--muted-foreground)' }}>
                  <AlertCircle className="spin-animation" size={32} style={{ color: 'var(--primary)' }} />
                  <span>Carregando templates...</span>
                </div>
              ) : templates.length === 0 ? (
                <div className="p-8" style={{ textAlign: 'center', color: 'var(--muted-foreground)', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px dashed var(--border)' }}>Nenhum template encontrado nesta conta.</div>
              ) : (
                <div className="grid-2 gap-4">
                  {templates.map(tpl => {
                    const body = tpl.components?.find((c: any) => c.type === 'BODY')?.text || 'Sem corpo de texto';
                    const isApproved = tpl.status === 'APPROVED';

                    return (
                      <div key={tpl.id} className="card hover-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                        <div className="flex justify-between items-start mb-3">
                          <h4 className="m-0" style={{ fontSize: '15px', wordBreak: 'break-all', fontWeight: 600, color: 'var(--foreground)' }}>{tpl.name}</h4>
                          <span className={`badge ${isApproved ? 'badge--success' : 'badge--warning'}`} style={{ fontSize: '10px', padding: '4px 8px' }}>
                            {tpl.status}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {tpl.language} • {tpl.category}
                        </div>
                        <div style={{ background: 'var(--card)', padding: '16px', borderRadius: '8px', fontSize: '13px', flex: 1, whiteSpace: 'pre-wrap', color: 'var(--foreground)', border: '1px solid var(--border)', lineHeight: '1.5' }}>
                          {body}
                        </div>
                        <div className="flex gap-3 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                          <button
                            className="btn btn--primary w-full"
                            style={{ flex: 1, padding: '10px' }}
                            onClick={() => {
                              const hasVariables = /\{\{\d+\}\}/.test(body);
                              onSelectTemplate(tpl.name, hasVariables);
                            }}
                            disabled={!isApproved}
                          >
                            Usar Template
                          </button>
                          <button className="btn btn--outline" onClick={() => deleteTemplate(tpl.name)} title="Apagar" style={{ padding: '10px', color: 'var(--destructive)', borderColor: 'var(--destructive)' }}>
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1, paddingRight: '8px' }}>
            <h4 className="h4 mb-6">Criar Novo Template (Texto Simples)</h4>

            <div className="form-group mb-5">
              <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Nome do Template <span style={{ color: 'var(--destructive)' }}>*</span></label>
              <input type="text" className="input" placeholder="ex: alerta_promocao_v1" value={newTplName} onChange={e => setNewTplName(e.target.value)} style={{ fontSize: '15px', padding: '12px' }} />
              <p className="t-xs t-muted mt-2">Apenas letras minúsculas, números e underline.</p>
            </div>

            <div className="grid-2 gap-6 mb-5">
              <div className="form-group mb-0">
                <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Categoria</label>
                <select className="input" value={newTplCategory} onChange={e => setNewTplCategory(e.target.value)} style={{ fontSize: '15px', padding: '12px' }}>
                  <option value="MARKETING">Marketing (Vendas, Promoções)</option>
                  <option value="UTILITY">Utilidade (Avisos, Confirmações)</option>
                  <option value="AUTHENTICATION">Autenticação (Senhas, Tokens)</option>
                </select>
              </div>
              <div className="form-group mb-0">
                <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Idioma</label>
                <select className="input" value={newTplLanguage} onChange={e => setNewTplLanguage(e.target.value)} style={{ fontSize: '15px', padding: '12px' }}>
                  <option value="pt_BR">Português (Brasil)</option>
                  <option value="en_US">Inglês (EUA)</option>
                  <option value="es">Espanhol</option>
                </select>
              </div>
            </div>

            <div className="form-group mb-5">
              <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Cabeçalho (Opcional)</label>
              <select className="input mb-3" value={newTplHeaderType} onChange={e => setNewTplHeaderType(e.target.value)} style={{ fontSize: '15px', padding: '12px' }}>
                <option value="NONE">Nenhum</option>
                <option value="TEXT">Texto</option>
                <option value="MEDIA">Mídia (Imagem/Vídeo/Documento)</option>
              </select>

              {newTplHeaderType === 'TEXT' && (
                <input type="text" className="input mt-2" placeholder="Ex: Aviso Importante" value={newTplHeaderText} onChange={e => setNewTplHeaderText(e.target.value)} maxLength={60} style={{ fontSize: '15px', padding: '12px' }} />
              )}
              {newTplHeaderType === 'MEDIA' && (
                <div className="alert alert--warning mt-2 t-xs" style={{ borderRadius: '8px' }}>
                  Para criar templates com cabeçalho de Mídia, utilize o <strong>Gerenciador do WhatsApp (Meta Business Suite)</strong>. A API exige upload direto do arquivo para gerar um identificador.
                </div>
              )}
            </div>

            <div className="form-group mb-5">
              <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Texto da Mensagem (Corpo) <span style={{ color: 'var(--destructive)' }}>*</span></label>
              <textarea
                className="input"
                rows={5}
                placeholder="Olá {{1}}, confira nossa oferta..."
                value={newTplBody}
                onChange={e => setNewTplBody(e.target.value)}
                style={{ fontSize: '15px', padding: '16px', lineHeight: '1.5' }}
              ></textarea>
              <p className="t-xs t-muted mt-2">Use {'{{1}}'}, {'{{2}}'} para variáveis. O sistema adicionará automaticamente exemplos para evitar que a Meta rejeite seu modelo.</p>
            </div>

            <div className="form-group mb-5">
              <label className="label" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Rodapé (Opcional)</label>
              <input type="text" className="input" placeholder="Ex: Caso não queira receber mensagens, digite SAIR" value={newTplFooterText} onChange={e => setNewTplFooterText(e.target.value)} maxLength={60} style={{ fontSize: '15px', padding: '12px' }} />
            </div>

            <div className="form-group mb-6">
              <div className="flex justify-between items-center mb-3">
                <label className="label m-0" style={{ fontWeight: 600, color: 'var(--foreground)' }}>Botões (Opcional, Máx 3)</label>
                {newTplButtons.length < 3 && (
                  <button className="btn btn--outline btn--sm" onClick={() => setNewTplButtons([...newTplButtons, { type: 'QUICK_REPLY', text: '' }])} style={{ padding: '6px 12px' }}>
                    <Plus size={14} style={{ marginRight: '6px' }} /> Adicionar Botão
                  </button>
                )}
              </div>

              {newTplButtons.map((btn, idx) => (
                <div key={idx} className="flex gap-3 mb-3 p-4" style={{ background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <select className="input" style={{ width: '180px', fontSize: '14px', padding: '10px' }} value={btn.type} onChange={e => {
                    const btns = [...newTplButtons];
                    btns[idx].type = e.target.value;
                    setNewTplButtons(btns);
                  }}>
                    <option value="QUICK_REPLY">Resposta Rápida</option>
                    <option value="URL">Acessar Site</option>
                  </select>

                  <input type="text" className="input" placeholder="Texto do botão" style={{ flex: 1, fontSize: '14px', padding: '10px' }} value={btn.text} onChange={e => {
                    const btns = [...newTplButtons];
                    btns[idx].text = e.target.value;
                    setNewTplButtons(btns);
                  }} maxLength={25} />

                  {btn.type === 'URL' && (
                    <input type="text" className="input" placeholder="https://..." style={{ flex: 1, fontSize: '14px', padding: '10px' }} value={btn.url || ''} onChange={e => {
                      const btns = [...newTplButtons];
                      btns[idx].url = e.target.value;
                      setNewTplButtons(btns);
                    }} />
                  )}

                  <button className="btn btn--outline" style={{ color: 'var(--destructive)', borderColor: 'var(--destructive)', padding: '0 14px' }} onClick={() => {
                    const btns = [...newTplButtons];
                    btns.splice(idx, 1);
                    setNewTplButtons(btns);
                  }}>
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-4 justify-end mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
              <button className="btn btn--outline" onClick={() => setIsCreating(false)} disabled={isSaving} style={{ padding: '12px 24px', fontSize: '15px' }}>Cancelar</button>
              <button className="btn btn--primary" onClick={handleCreateTemplate} disabled={isSaving} style={{ padding: '12px 32px', fontSize: '15px', fontWeight: 600 }}>
                {isSaving ? 'Criando...' : 'Enviar para Aprovação'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
