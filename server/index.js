import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { google } from 'googleapis';
import pool from './db.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({limit: '50mb'}));
const PORT = process.env.PORT || 3001;

// Endpoints do Banco de Dados (MySQL)
app.get('/api/db/logics', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM logics WHERE account_id = 1');
    const logics = rows.map(r => {
      let parsedConfig = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
      // Compatibilidade retroativa para dados migrados erroneamente (com config dentro de config)
      if (parsedConfig && parsedConfig.config && Object.keys(parsedConfig).length <= 4) {
        parsedConfig = parsedConfig.config;
      }
      return { id: r.id, name: r.name, config: parsedConfig };
    });
    res.json(logics);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar lógicas.' });
  }
});

app.post('/api/db/logics', async (req, res) => {
  try {
    const { logic } = req.body;
    const actualConfig = logic.config; // Pega apenas a propriedade config
    
    // Upsert logic
    const [existing] = await pool.query('SELECT id FROM logics WHERE id = ?', [logic.id]);
    if (existing.length > 0) {
      await pool.query('UPDATE logics SET name = ?, config = ? WHERE id = ?', [logic.name, JSON.stringify(actualConfig), logic.id]);
    } else {
      await pool.query('INSERT INTO logics (id, account_id, name, config) VALUES (?, ?, ?, ?)', [logic.id, 1, logic.name, JSON.stringify(actualConfig)]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao salvar lógica.' });
  }
});

app.get('/api/db/history', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM history WHERE account_id = 1 ORDER BY date DESC');
    const history = rows.map(r => ({
      ...r,
      sentPhones: typeof r.sent_phones === 'string' ? JSON.parse(r.sent_phones) : r.sent_phones,
      processedRows: typeof r.processed_rows === 'string' ? JSON.parse(r.processed_rows) : r.processed_rows,
      logicName: r.logic_name,
      sheetName: r.sheet_name,
      wpSent: r.wp_sent,
      crmUpdates: r.crm_updates
    }));
    res.json(history);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar histórico.' });
  }
});

// Configuração do Google Sheets via OAuth2
const REDIRECT_URI = 'http://localhost:3001/api/oauth-callback';

async function getOAuth2Client() {
  const [rows] = await pool.query('SELECT * FROM oauth_config WHERE account_id = 1');
  if (rows.length === 0 || !rows[0].client_id) {
    throw new Error('Client ID e Client Secret não configurados no banco de dados.');
  }
  const { client_id, client_secret } = rows[0];
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

async function getGoogleSheetsClient() {
  const oAuth2Client = await getOAuth2Client();
  const [rows] = await pool.query('SELECT tokens FROM oauth_config WHERE account_id = 1');
  if (rows.length === 0 || !rows[0].tokens) {
    throw new Error('Conta do Google não conectada. Faça o login ("Sign in with Google") na aba de configurações.');
  }
  const tokens = typeof rows[0].tokens === 'string' ? JSON.parse(rows[0].tokens) : rows[0].tokens;
  oAuth2Client.setCredentials(tokens);
  return google.sheets({ version: 'v4', auth: oAuth2Client });
}

// Endpoint para salvar Client ID e Client Secret
app.post('/api/save-oauth-credentials', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'Client ID e Client Secret são obrigatórios.' });
    }
    const [existing] = await pool.query('SELECT id FROM oauth_config WHERE account_id = 1');
    if (existing.length > 0) {
      await pool.query('UPDATE oauth_config SET client_id = ?, client_secret = ? WHERE account_id = 1', [clientId, clientSecret]);
    } else {
      await pool.query('INSERT INTO oauth_config (account_id, client_id, client_secret) VALUES (?, ?, ?)', [1, clientId, clientSecret]);
    }
    res.json({ message: 'Credenciais salvas com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar credenciais.' });
  }
});

// Endpoint para iniciar o login do Google (Gera a URL e redireciona)
app.get('/api/auth/google', async (req, res) => {
  try {
    const oAuth2Client = await getOAuth2Client();
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    res.redirect(authUrl);
  } catch (error) {
    res.status(400).send(`Erro: ${error.message}`);
  }
});

// Callback do Google após o login
app.get('/api/oauth-callback', async (req, res) => {
  try {
    const code = req.query.code;
    const oAuth2Client = await getOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    await pool.query('UPDATE oauth_config SET tokens = ? WHERE account_id = 1', [JSON.stringify(tokens)]);
    // Redireciona de volta para o app
    res.redirect('http://localhost:5173/?auth=success');
  } catch (error) {
    res.status(500).send(`Erro de autenticação: ${error.message}`);
  }
});

// Tentar criar a coluna meta_access_token se não existir (ignora erro se já existir)
pool.query('ALTER TABLE oauth_config ADD COLUMN meta_access_token TEXT').catch(() => {});

// Endpoint para verificar status
app.get('/api/auth/status', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT client_id, tokens, meta_access_token FROM oauth_config WHERE account_id = 1');
    const hasCredentials = rows.length > 0 && !!rows[0].client_id;
    const isConnected = rows.length > 0 && !!rows[0].tokens;
    const metaToken = rows.length > 0 ? rows[0].meta_access_token : null;
    res.json({ hasCredentials, isConnected, metaToken });
  } catch (error) {
    res.json({ hasCredentials: false, isConnected: false, metaToken: null });
  }
});

// Endpoint para salvar o token do Meta (Facebook)
app.post('/api/save-meta-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });
    
    const [existing] = await pool.query('SELECT id FROM oauth_config WHERE account_id = 1');
    if (existing.length > 0) {
      await pool.query('UPDATE oauth_config SET meta_access_token = ? WHERE account_id = 1', [token]);
    } else {
      await pool.query('INSERT INTO oauth_config (account_id, meta_access_token) VALUES (1, ?)', [token]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar token da Meta:', error);
    res.status(500).json({ error: 'Erro ao salvar token da Meta.' });
  }
});

// Endpoint para buscar as colunas da planilha
app.post('/api/sheet-columns', async (req, res) => {
  try {
    const { sheetId, sheetName } = req.body;
    if (!sheetId || !sheetName) {
      return res.status(400).json({ error: 'sheetId e sheetName são obrigatórios' });
    }
    
    const sheets = await getGoogleSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!1:1`, // Pega apenas a primeira linha (cabeçalhos)
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Nenhum dado encontrado na planilha (primeira linha está vazia).' });
    }

    const headers = rows[0];
    res.json({ columns: headers });
  } catch (error) {
    console.error('Erro ao buscar colunas:', error);
    res.status(500).json({ error: error.message });
  }
});

const globalStopFlags = {};
const preparedCampaigns = {};

app.post('/api/prepare-campaign', (req, res) => {
  const campaignId = Date.now().toString() + Math.random().toString(36).substring(7);
  preparedCampaigns[campaignId] = req.body; // Expects { logic, contacts }
  
  // Limpar campanhas antigas para evitar memory leak
  const keys = Object.keys(preparedCampaigns);
  if (keys.length > 20) {
    delete preparedCampaigns[keys[0]];
  }
  
  res.json({ campaignId });
});

// Rota para rodar o disparo dinâmico com Server-Sent Events (SSE)
app.get('/api/run-dynamic', async (req, res) => {
  const logicParam = req.query.logic;
  if (logicParam) {
    try {
      const parsed = JSON.parse(logicParam);
      global.activeCronJobs[parsed.id] = true;
    } catch(e){}
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Estabelece a conexão SSE

  const sendLog = (type, message, data = {}) => {
    res.write(`data: ${JSON.stringify({ type, message, ...data })}\n\n`);
  };

  function parsePtBrDate(dateStr) {
    if (!dateStr) return null;
    const cleanStr = dateStr.replace(',', '').trim();
    const parts = cleanStr.split(' ');
    if (parts.length < 2) return null;
    const [day, month, year] = parts[0].split('/');
    const [hour, minute, second] = parts[1].split(':');
    if (!day || !month || !year || !hour || !minute) return null;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second || '00'}-03:00`);
  }

  try {
    let logic, contacts;
    const campaignId = req.query.campaignId;

    if (campaignId && preparedCampaigns[campaignId]) {
      logic = preparedCampaigns[campaignId].logic;
      contacts = preparedCampaigns[campaignId].contacts;
    } else {
      const logicStr = req.query.logic;
      if (!logicStr) {
        sendLog('error', 'Lógica ou Campanha não fornecida');
        return res.end();
      }
      logic = JSON.parse(logicStr);
    }

    const { googleSheets, crm, whatsapp } = logic.config;

    sendLog('info', 'Iniciando processamento da campanha...');

    let headers = [];
    let dataRows = [];

    // Se temos contatos (CSV), usamos eles. Senão, tentamos Google Sheets (Legado).
    if (contacts && Array.isArray(contacts)) {
       sendLog('info', `Carregado ${contacts.length} contatos da lista CSV.`);
       headers = ['Nome', 'Telefone'];
       dataRows = contacts.map(c => [c.nome, c.telefone]);
    } else {
       if (!googleSheets || !googleSheets.enabled || !googleSheets.sheetId || !googleSheets.sheetName) {
         sendLog('error', 'Nenhum contato enviado e Google Sheets não configurado.');
         return res.end();
       }

       const sheets = await getGoogleSheetsClient();
       sendLog('info', `Lendo aba ${googleSheets.sheetName}...`);

       const response = await sheets.spreadsheets.values.get({
         spreadsheetId: googleSheets.sheetId,
         range: `${googleSheets.sheetName}!A:AZ`,
       });

       const rows = response.data.values;
       if (!rows || rows.length < 2) {
         sendLog('info', 'Nenhum dado encontrado para processar no Sheets.');
         sendLog('done', 'Finalizado');
         return res.end();
       }

       headers = rows[0];
       dataRows = rows.slice(1);
    }

    const filterColumn = googleSheets?.filterColumn;
    
    let countProcessed = 0;
    let countWp = 0;
    let countCrm = 0;
    let countErrors = 0;
    const sentPhones = [];
    const processedRows = [];
    const limit = googleSheets.limitRows ? parseInt(googleSheets.limitRows) : 50;
    
    // Limpar flag de stop
    globalStopFlags[logic.id] = false;
    
    // Configurações de Atraso
    const delayNumber = whatsapp.delayBetweenNumbers || 0;
    const delayLead = whatsapp.delayBetweenLeads || 0;
    
    // Sleep que pode ser interrompido instantaneamente se o usuário clicar em Parar
    const sleep = async (ms) => {
      const chunks = Math.ceil(ms / 500); // Check a cada 500ms
      for (let j = 0; j < chunks; j++) {
        if (globalStopFlags[logic.id]) return;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    };

    // Índices de Rodízio Exato (Round-Robin)
    let currentTemplateIndex = 0;
    let currentPhoneIndex = 0;

    // Processamento
    for (let i = 0; i < dataRows.length; i++) {
      if (globalStopFlags[logic.id]) {
        sendLog('info', `Execução interrompida pelo usuário.`);
        break;
      }

      if (countProcessed >= limit) {
        sendLog('info', `Limite de ${limit} processamentos alcançado por segurança.`);
        break;
      }
      
      // Pausa automática por horário (Cron)
      const respectCronTime = googleSheets?.respectCronTime !== false;
      if (respectCronTime && logic.config.cron && logic.config.cron.enabled && logic.config.cron.endTime) {
        const now = new Date();
        const [endH, endM] = logic.config.cron.endTime.split(':').map(Number);
        if (now.getHours() * 60 + now.getMinutes() > endH * 60 + endM) {
          sendLog('info', `Horário limite de disparo (${logic.config.cron.endTime}) atingido. Execução pausada até o próximo ciclo.`);
          break;
        }
      }

      // Check pause
      const rowData = dataRows[i];
      let nome = '';
      let telefone = '';

      if (contacts) {
        // Formato da matriz via contatos mockados
        nome = rowData[0] || '';
        telefone = rowData[1] || '';
      } else {
        // Formato legado Sheets
        nome = googleSheets.nameColumn ? rowData[headers.indexOf(googleSheets.nameColumn)] || '' : '';
        telefone = googleSheets.phoneColumn ? rowData[headers.indexOf(googleSheets.phoneColumn)] || '' : '';
      }

      const row = dataRows[i];
      const rowIndex = i + 2;

      const getCol = (colName) => row[headers.indexOf(colName)] || '';
      
      // Aplicar os filtros dinâmicos
      let skipRow = false;
      const filters = googleSheets.filters || [];
      
      for (const filter of filters) {
        if (!filter.column) continue;
        const cellValue = String(getCol(filter.column)).trim();
        
        if (filter.operator === 'empty' && cellValue !== '') { skipRow = true; break; }
        if (filter.operator === 'not_empty' && cellValue === '') { skipRow = true; break; }
        if (filter.operator === 'equals' && cellValue !== filter.value) { skipRow = true; break; }
        if (filter.operator === 'not_equals' && cellValue === filter.value) { skipRow = true; break; }
      }

      // Regra de Follow-up
      if (googleSheets.followUpEnabled && googleSheets.followUpColumn && googleSheets.followUpHours > 0 && !skipRow) {
        const refDateStr = getCol(googleSheets.followUpColumn);
        if (!refDateStr || refDateStr.trim() === '') {
          skipRow = true;
        } else {
          const refDate = parsePtBrDate(refDateStr);
          if (refDate && !isNaN(refDate.getTime())) {
            const now = new Date();
            const diffMs = now.getTime() - refDate.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            if (diffHours < googleSheets.followUpHours) {
              skipRow = true;
              sendLog('info', `Linha ${rowIndex}: Aguardando Follow-up (Passou ${diffHours.toFixed(1)}h de ${googleSheets.followUpHours}h)`);
            }
          } else {
            skipRow = true;
            sendLog('warn', `Linha ${rowIndex}: Data base de Follow-up inválida (${refDateStr}).`);
          }
        }
      }

      if (skipRow) continue;
      
      processedRows.push(rowIndex);

      // Pegando dados básicos do contato
      const nomeCompleto = contacts ? nome : (getCol('Nome') || getCol('nome') || 'Lead');
      const primeiroNome = nomeCompleto.split(' ')[0] || 'Lead';
      const nomeCapitalizado = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1).toLowerCase();

      sendLog('info', `Processando: ${nomeCompleto} (Linha ${rowIndex})`);
      let dealId = '';

      // WHATSAPP (Se ativado)
      let msgSent = false;
      if (whatsapp.enabled && whatsapp.phoneId && whatsapp.token && whatsapp.templateName) {
        
        // Determina o remetente uma única vez por Lead (Linha)
        let leadPhoneId = whatsapp.phoneId.trim();
        let leadToken = whatsapp.token.trim();
        
        const colNumberName = headers.find(h => h.toLowerCase() === 'number');
        const existingId = colNumberName ? getCol(colNumberName) : null;
        
        if (existingId && existingId.trim() !== '') {
          leadPhoneId = existingId.trim();
          if (whatsapp.phoneId2 && leadPhoneId === whatsapp.phoneId2.trim() && whatsapp.token2) {
            leadToken = whatsapp.token2.trim();
          }
        } else if (whatsapp.randomizeNumbers && whatsapp.secondaryPhones && whatsapp.secondaryPhones.length > 0) {
          // Build array of all available phones
          const allPhones = [{ phoneId: whatsapp.phoneId.trim(), token: whatsapp.token.trim() }];
          whatsapp.secondaryPhones.forEach(sp => {
            if (sp.phoneId && sp.token) {
              allPhones.push({ phoneId: sp.phoneId.trim(), token: sp.token.trim() });
            }
          });
          // Pick strictly exact sequentially
          const chosenPhone = allPhones[currentPhoneIndex % allPhones.length];
          currentPhoneIndex++;
          
          leadPhoneId = chosenPhone.phoneId;
          leadToken = chosenPhone.token;
        }

        let numbersToMsg = [];
        
        if (contacts) {
          // Se for CSV, usa o telefone direto
          if (telefone) numbersToMsg.push({ phone: telefone, source: 'CSV' });
          else sendLog('warn', `Linha ${rowIndex}: Telefone em branco no CSV.`);
        } else {
          // Lógica legada para Sheets
          const phoneColumns = whatsapp.phoneColumns || [];
          if (phoneColumns.length === 0) {
            sendLog('warn', `Linha ${rowIndex}: Nenhuma coluna de telefone configurada na lógica.`);
          } else {
            phoneColumns.forEach(colName => {
              const t = getCol(colName);
              if (t) numbersToMsg.push({ phone: t, source: colName });
            });
          }
        }

        for (let j = 0; j < numbersToMsg.length; j++) {
          let numStr = numbersToMsg[j].phone;
          const colName = numbersToMsg[j].source;
          
          if (numStr) {
            numStr = numStr.toString().replace(/\D/g, '');
            if (numStr.length >= 10) {
              if (!numStr.startsWith('55')) numStr = '55' + numStr;

                try {
                  const currentPhoneId = leadPhoneId;
                  const currentToken = leadToken;

                  const params = [
                    { type: "text", parameter_name: "nome", text: nomeCapitalizado || "Lead" }
                  ];

                  const allTemplates = [whatsapp.templateName.trim()];
                  if (whatsapp.randomizeTemplates && whatsapp.secondaryTemplates && whatsapp.secondaryTemplates.length > 0) {
                    whatsapp.secondaryTemplates.forEach(t => {
                      if (t && t.trim() !== '') allTemplates.push(t.trim());
                    });
                  }
                  const chosenTemplateName = allTemplates[currentTemplateIndex % allTemplates.length];
                  currentTemplateIndex++;

                  const hasVariables = whatsapp.templateVarsMap ? whatsapp.templateVarsMap[chosenTemplateName] : true;

                  const whatsappBody = {
                    messaging_product: "whatsapp",
                    to: numStr,
                    type: "template",
                    template: {
                      name: chosenTemplateName,
                      language: { code: "pt_BR" }
                    }
                  };

                  if (hasVariables !== false) {
                    whatsappBody.template.components = [
                      {
                        type: "body",
                        parameters: params
                      }
                    ];
                  }

                  const whatsappUrl = `https://graph.facebook.com/v25.0/${currentPhoneId}/messages`;
                  const wpResponse = await axios.post(whatsappUrl, whatsappBody, {
                    headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json' }
                  });
                  
                  // Atualiza whatsapp object temp para o update da planilha pegar o ID usado
                  whatsapp.currentUsedPhoneId = currentPhoneId;
                  
                  const msgId = wpResponse.data?.messages?.[0]?.id || 'ID desconhecido';
                  const waId = wpResponse.data?.contacts?.[0]?.wa_id || numStr;
                  
                  sendLog('success', `WhatsApp aceito: ${waId} | Tpl: ${chosenTemplateName} | Msg ID: ${msgId}`);
                  msgSent = true;
                  countWp++;
                  
                  let rowDetail = sentPhones.find(d => d.row === rowIndex);
                  if (!rowDetail) {
                    rowDetail = { row: rowIndex, phones: [] };
                    sentPhones.push(rowDetail);
                  }
                  rowDetail.phones.push(waId);
                } catch (wpError) {
                  const errData = wpError.response?.data;
                  const errStr = errData ? JSON.stringify(errData) : '';
                  const expectedMatch = errStr.match(/expected number of params \((\d+)\)/);

                  if (errData?.error?.code === 132000 && expectedMatch) {
                    const expectedCount = parseInt(expectedMatch[1], 10);
                    try {
                      if (expectedCount === 0) {
                        delete whatsappBody.template.components;
                      } else {
                        const newParams = [];
                        for (let k = 0; k < expectedCount; k++) {
                          // O primeiro parâmetro será sempre o Nome. Os demais receberão um "-" como fallback
                          newParams.push({
                            type: "text",
                            text: k === 0 ? (nomeCapitalizado || "Lead") : "-"
                          });
                        }
                        whatsappBody.template.components = [{
                          type: "body",
                          parameters: newParams
                        }];
                      }

                      const wpResponse2 = await axios.post(whatsappUrl, whatsappBody, {
                        headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json' }
                      });
                      whatsapp.currentUsedPhoneId = currentPhoneId;
                      const msgId = wpResponse2.data?.messages?.[0]?.id || 'ID desconhecido';
                      const waId = wpResponse2.data?.contacts?.[0]?.wa_id || numStr;
                      
                      sendLog('success', `WhatsApp aceito (Auto-ajuste de ${expectedCount} variáveis): ${waId} | Tpl: ${chosenTemplateName} | Msg ID: ${msgId}`);
                      msgSent = true;
                      countWp++;
                      
                      let rowDetail = sentPhones.find(d => d.row === rowIndex);
                      if (!rowDetail) {
                        rowDetail = { row: rowIndex, phones: [] };
                        sentPhones.push(rowDetail);
                      }
                      rowDetail.phones.push(waId);
                    } catch (retryErr) {
                      const retryErrData = retryErr.response?.data;
                      const retryErrMsg = retryErrData ? (typeof retryErrData === 'object' ? JSON.stringify(retryErrData) : retryErrData) : retryErr.message;
                      sendLog('error', `Falha WhatsApp (Retry sem var) para ${numStr}: ${retryErrMsg}`);
                      countErrors++;
                    }
                  } else {
                    const errMsg = errData ? (typeof errData === 'object' ? JSON.stringify(errData) : errData) : wpError.message;
                    sendLog('error', `Falha WhatsApp para ${numStr}: ${errMsg}`);
                    countErrors++;
                  }
                }
                
                if (j < numbersToMsg.length - 1 && delayNumber > 0) {
                  sendLog('info', `Aguardando ${delayNumber}s antes do próximo número do lead...`);
                  await sleep(delayNumber * 1000);
                  if (globalStopFlags[logic.id]) break;
                }
              }
            }
          }
        }

      if (globalStopFlags[logic.id]) break;

      // Atualizar a planilha com o timestamp do WhatsApp
      if (googleSheets.enabled && msgSent) {
        const now = new Date();
        const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        
        const columnToLetter = (column) => {
          let temp, letter = '';
          while (column >= 0) {
            temp = column % 26;
            letter = String.fromCharCode(temp + 65) + letter;
            column = (column - temp - 1) / 26;
          }
          return letter;
        };

        if (filterColumn && headers.indexOf(filterColumn) !== -1) {
          const colIndex = headers.indexOf(filterColumn);
          const letterEnvio = columnToLetter(colIndex);
          try {
            await sheets.spreadsheets.values.update({
              spreadsheetId: googleSheets.sheetId,
              range: `${googleSheets.sheetName}!${letterEnvio}${rowIndex}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [[timestamp]] }
            });
            sendLog('success', `Timestamp gravado na planilha.`);
          } catch (e) {}
        }

        const colNumber = headers.indexOf('number') !== -1 ? headers.indexOf('number') : (headers.indexOf('Number') !== -1 ? headers.indexOf('Number') : -1);
        if (colNumber !== -1 && whatsapp.currentUsedPhoneId) {
          const letterNumber = columnToLetter(colNumber);
          try {
            await sheets.spreadsheets.values.update({
              spreadsheetId: googleSheets.sheetId,
              range: `${googleSheets.sheetName}!${letterNumber}${rowIndex}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [[whatsapp.currentUsedPhoneId]] }
            });
            sendLog('success', `ID do remetente (${whatsapp.currentUsedPhoneId}) gravado na coluna number.`);
          } catch (e) {}
        }
      }

      // Atualizar id_lead na planilha se CRM retornou o ID
      if (googleSheets.enabled && dealId) {
        const columnToLetter = (column) => {
          let temp, letter = '';
          while (column >= 0) {
            temp = column % 26;
            letter = String.fromCharCode(temp + 65) + letter;
            column = (column - temp - 1) / 26;
          }
          return letter;
        };

        const colIdLead = headers.indexOf('id_lead');
        if (colIdLead !== -1) {
          const letterIdLead = columnToLetter(colIdLead);
          try {
            await sheets.spreadsheets.values.update({
              spreadsheetId: googleSheets.sheetId,
              range: `${googleSheets.sheetName}!${letterIdLead}${rowIndex}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [[dealId]] }
            });
            sendLog('success', `ID do Lead (${dealId}) atualizado na planilha.`);
          } catch (e) {
            sendLog('warn', `Falha ao gravar ID do Lead na planilha: ${e.message}`);
          }
        }
      }

      countProcessed++;
      
      // Envia progresso em tempo real
      sendLog('progress', 'Atualização de progresso', {
        processed: countProcessed,
        wpSent: countWp,
        crmUpdates: countCrm,
        errors: countErrors,
        sentPhones: sentPhones,
        processedRows: processedRows
      });
      
      // Delay entre leads
      if (i < dataRows.length - 1 && delayLead > 0 && countProcessed < limit) {
        sendLog('info', `Aguardando ${delayLead}s antes do próximo lead...`);
        await sleep(delayLead * 1000);
      }
    }

    // Salvar no Histórico
    try {
      const historyId = Date.now().toString();
      const status = countErrors === 0 ? 'Concluído' : 'Com Erros';
      const dateStr = new Date().toLocaleString('pt-BR');
      
      await pool.query(
        'INSERT INTO history (id, account_id, logic_name, sheet_name, date, processed, wp_sent, crm_updates, errors, sent_phones, processed_rows, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          historyId,
          1,
          logic.name,
          googleSheets.sheetName || 'N/A',
          dateStr,
          countProcessed,
          countWp,
          countCrm,
          countErrors,
          JSON.stringify(sentPhones || []),
          JSON.stringify(processedRows || []),
          status
        ]
      );
      
      // Limpar histórico antigo se houver mais de 50
      const [rows] = await pool.query('SELECT id FROM history WHERE account_id = 1 ORDER BY date DESC LIMIT 50, 1000');
      if (rows.length > 0) {
        const idsToDelete = rows.map(r => r.id);
        await pool.query('DELETE FROM history WHERE id IN (?)', [idsToDelete]);
      }
    } catch (e) {
      console.error('Erro ao salvar histórico no MySQL', e);
    }

    sendLog('done', `Processamento finalizado. Lotes executados: ${countProcessed}`, { processed: countProcessed });
    res.end();
  } catch (error) {
    sendLog('error', `Erro geral: ${error.message}`);
    sendLog('done', 'Finalizado com erros');
    res.end();
  } finally {
    const parsedLogicId = req.query.logic ? JSON.parse(req.query.logic).id : '';
    delete globalStopFlags[parsedLogicId];
    delete global.activeCronJobs[parsedLogicId];
  }
});

app.post('/api/stop', (req, res) => {
  const { logicId } = req.body;
  if (logicId) {
    globalStopFlags[logicId] = true;
    res.json({ success: true, message: 'Sinal de interrupção enviado.' });
  } else {
    res.status(400).json({ error: 'logicId é obrigatório' });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ activeLogics: Object.keys(global.activeCronJobs) });
});

// --- CRON SYSTEM ---
global.activeCronJobs = {};

setInterval(async () => {
  try {
    const [rows] = await pool.query('SELECT * FROM logics WHERE account_id = 1');
    const logics = rows.map(r => {
      let parsedConfig = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
      if (parsedConfig && parsedConfig.config && Object.keys(parsedConfig).length <= 4) {
        parsedConfig = parsedConfig.config;
      }
      return { id: r.id, name: r.name, config: parsedConfig };
    });

    const now = new Date();
    const currentDayStr = now.getDay().toString();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const currentTimeInt = currentHour * 60 + currentMin;

    for (const logic of logics) {
      if (!logic.config || !logic.config.cron || !logic.config.cron.enabled) continue;
      
      const { days, startTime, endTime } = logic.config.cron;
      if (!days || !days.includes(currentDayStr)) continue;

      if (startTime && endTime) {
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const startTimeInt = startH * 60 + startM;
        const endTimeInt = endH * 60 + endM;

        if (currentTimeInt >= startTimeInt && currentTimeInt <= endTimeInt) {
          // Já está rodando?
          if (global.activeCronJobs[logic.id]) continue;

          console.log(`[CRON] Iniciando disparo agendado para lógica: ${logic.name}`);
          global.activeCronJobs[logic.id] = true;

          axios.get(`http://localhost:${PORT}/api/run-dynamic?logic=${encodeURIComponent(JSON.stringify(logic))}`)
            .then(() => {
              console.log(`[CRON] Disparo finalizado: ${logic.name}`);
              delete global.activeCronJobs[logic.id];
            })
            .catch(err => {
              console.error(`[CRON] Erro no disparo: ${logic.name}`, err.message);
              delete global.activeCronJobs[logic.id];
            });
        }
      }
    }
  } catch (err) {
    console.error('[CRON] Erro no loop:', err);
  }
}, 60 * 1000 * 2); // Roda a cada 2 minutos

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
