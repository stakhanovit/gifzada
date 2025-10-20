
const { Client } = require('pg');
require('dotenv').config();

async function testConnection() {
  console.log('🔍 Testando conexão com PostgreSQL...\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL não encontrado!');
    console.error('Adicione DATABASE_URL nos Secrets do Replit');
    return;
  }

  console.log('✅ DATABASE_URL encontrado');
  console.log('📝 Formato: ' + process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('\n🔌 Tentando conectar...');
    await client.connect();
    console.log('✅ Conexão estabelecida com sucesso!\n');

    console.log('📊 Testando query...');
    const result = await client.query('SELECT NOW()');
    console.log('✅ Query executada com sucesso!');
    console.log('⏰ Hora do servidor:', result.rows[0].now);

    console.log('\n📋 Listando tabelas existentes...');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    if (tables.rows.length === 0) {
      console.log('⚠️  Nenhuma tabela encontrada (banco vazio)');
    } else {
      console.log(`✅ ${tables.rows.length} tabela(s) encontrada(s):`);
      tables.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }

    await client.end();
    console.log('\n✅ Teste concluído com sucesso!');

  } catch (error) {
    console.error('\n❌ Erro durante o teste:', error.message);
    console.error('\n📋 Possíveis soluções:');
    console.error('1. Verifique se o DATABASE_URL está correto');
    console.error('2. Confirme que o banco PostgreSQL está acessível');
    console.error('3. Verifique as credenciais de acesso');
  }
}

testConnection();
