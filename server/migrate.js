import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const dbConfig = {
  host: '',
  user: '',
  password: '',
  port: 3306
};

async function migrate() {
  console.log('🔄 Iniciando migração para MySQL...');
  
  // 1. Conectar sem banco de dados para criar se não existir
  let conn = await mysql.createConnection(dbConfig);
  
  await conn.query('CREATE DATABASE IF NOT EXISTS disparo_massa');
  console.log('✅ Banco de dados disparo_massa criado ou já existente.');
  
  await conn.changeUser({ database: 'disparo_massa' });

  // 2. Criar Tabelas
  const createTablesSql = `
    CREATE TABLE IF NOT EXISTS accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS oauth_config (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      client_id VARCHAR(255),
      client_secret VARCHAR(255),
      tokens JSON,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS logics (
      id VARCHAR(100) PRIMARY KEY,
      account_id INT NOT NULL,
      name VARCHAR(255),
      config JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS history (
      id VARCHAR(100) PRIMARY KEY,
      account_id INT NOT NULL,
      logic_name VARCHAR(255),
      sheet_name VARCHAR(255),
      date VARCHAR(255),
      processed INT,
      wp_sent INT,
      crm_updates INT,
      errors INT,
      sent_phones JSON,
      processed_rows JSON,
      status VARCHAR(100),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
  `;

  // Executa os statements de criação de tabelas separadamente
  const statements = createTablesSql.split(';').filter(stmt => stmt.trim() !== '');
  for (let stmt of statements) {
    await conn.query(stmt);
  }
  console.log('✅ Tabelas criadas com sucesso (White Label Ready).');

  // 3. Criar a conta padrão (ID 1)
  const [accounts] = await conn.query('SELECT * FROM accounts WHERE id = 1');
  if (accounts.length === 0) {
    await conn.query('INSERT INTO accounts (id, name) VALUES (1, "Conta Padrão (Migrada)")');
    console.log('✅ Conta padrão ID 1 criada.');
  }

  // 4. Migrar OAuth
  const credsFile = path.resolve('oauth_credentials.json');
  const tokensFile = path.resolve('oauth_tokens.json');
  
  let clientId = null;
  let clientSecret = null;
  let tokens = null;

  if (fs.existsSync(credsFile)) {
    const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
    clientId = creds.clientId;
    clientSecret = creds.clientSecret;
  }
  
  if (fs.existsSync(tokensFile)) {
    tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  }

  if (clientId || tokens) {
    const [oauthRows] = await conn.query('SELECT * FROM oauth_config WHERE account_id = 1');
    if (oauthRows.length === 0) {
      await conn.query(
        'INSERT INTO oauth_config (account_id, client_id, client_secret, tokens) VALUES (?, ?, ?, ?)',
        [1, clientId, clientSecret, tokens ? JSON.stringify(tokens) : null]
      );
      console.log('✅ Dados do Google OAuth migrados com sucesso.');
    }
  }

  // 5. Migrar Logics e History do database.json
  const dbFile = path.resolve('database.json');
  if (fs.existsSync(dbFile)) {
    const localDb = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
    
    // Logics
    if (localDb.logics && localDb.logics.length > 0) {
      for (const logic of localDb.logics) {
        const [existing] = await conn.query('SELECT id FROM logics WHERE id = ?', [logic.id]);
        if (existing.length === 0) {
          const configCopy = { ...logic };
          delete configCopy.id;
          delete configCopy.name;
          
          await conn.query(
            'INSERT INTO logics (id, account_id, name, config) VALUES (?, ?, ?, ?)',
            [logic.id, 1, logic.name, JSON.stringify(configCopy)]
          );
        }
      }
      console.log(`✅ ${localDb.logics.length} lógicas migradas.`);
    }

    // History
    if (localDb.history && localDb.history.length > 0) {
      for (const hist of localDb.history) {
        const [existing] = await conn.query('SELECT id FROM history WHERE id = ?', [hist.id]);
        if (existing.length === 0) {
          await conn.query(
            'INSERT INTO history (id, account_id, logic_name, sheet_name, date, processed, wp_sent, crm_updates, errors, sent_phones, processed_rows, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              hist.id, 
              1, 
              hist.logicName, 
              hist.sheetName, 
              hist.date, 
              hist.processed || 0, 
              hist.wpSent || 0, 
              hist.crmUpdates || 0, 
              hist.errors || 0, 
              JSON.stringify(hist.sentPhones || []), 
              JSON.stringify(hist.processedRows || []), 
              hist.status || 'Concluído'
            ]
          );
        }
      }
      console.log(`✅ ${localDb.history.length} históricos de disparos migrados.`);
    }
  }

  console.log('🚀 Migração concluída com sucesso!');
  process.exit(0);
}

migrate().catch(console.error);
