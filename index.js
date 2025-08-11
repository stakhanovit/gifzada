

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { Client: PgClient } = require('pg');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath); 
const { execFile } = require('child_process');
let gifsicle;
const ytdl = require('@distube/ytdl-core');
const cron = require('node-cron');
const request = require('request');
const express = require('express');
const { createCanvas, loadImage, registerFont } = require('canvas');
require('dotenv').config();

// Registrar a fonte personalizada
registerFont('./Arial-bold.ttf', { family: 'Arial Bold' });

// Configuração do PostgreSQL
const pgClient = new PgClient({
  connectionString: process.env.DATABASE_URL
});

// Conectar ao PostgreSQL
pgClient.connect().then(() => {
  console.log('Conectado ao PostgreSQL');
  initializeDatabase();
}).catch(err => {
  console.error('Erro ao conectar ao PostgreSQL:', err);
});

// Função para inicializar tabelas do banco
async function initializeDatabase() {
  try {
    // Criar tabela de threads ativas
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS active_threads (
        user_id VARCHAR(20) PRIMARY KEY,
        thread_id VARCHAR(20) NOT NULL,
        thread_type VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de blacklist de recrutamento
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS recruitment_blacklist (
        user_id VARCHAR(20) PRIMARY KEY,
        reason TEXT,
        added_by VARCHAR(20) NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de feedbacks para desempenho do staff
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS staff_feedback (
        id SERIAL PRIMARY KEY,
        staff_id VARCHAR(20) NOT NULL,
        user_id VARCHAR(20),
        rating VARCHAR(20) NOT NULL,
        thread_type VARCHAR(50) NOT NULL,
        thread_id VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_automatic BOOLEAN DEFAULT FALSE
      )
    `);

    // Criar tabela de posts do Instagram
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS instagram_posts (
        post_id VARCHAR(50) PRIMARY KEY,
        author_id VARCHAR(20) NOT NULL,
        message_id VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        comments_private BOOLEAN DEFAULT FALSE,
        likes_private BOOLEAN DEFAULT FALSE
      )
    `);

    // Criar tabela de likes
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS post_likes (
        id SERIAL PRIMARY KEY,
        post_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES instagram_posts(post_id) ON DELETE CASCADE,
        UNIQUE(post_id, user_id)
      )
    `);

    // Criar tabela de comentários
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS post_comments (
        id SERIAL PRIMARY KEY,
        post_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        comment_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES instagram_posts(post_id) ON DELETE CASCADE
      )
    `);

    // Criar tabela de contadores de comentários por usuário
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS user_comment_counts (
        post_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        comment_count INTEGER DEFAULT 0,
        FOREIGN KEY (post_id) REFERENCES instagram_posts(post_id) ON DELETE CASCADE,
        PRIMARY KEY(post_id, user_id)
      )
    `);

    // Criar tabela de curtidas do Twitter
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS twitter_likes (
        id SERIAL PRIMARY KEY,
        post_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, user_id)
      )
    `);

    // Criar tabela de usuários que usaram o comando !gifs
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS gifs_users (
        user_id VARCHAR(20) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        has_gifs_in_profile BOOLEAN DEFAULT TRUE
      )
    `);

    // Criar tabela de pontos dos usuários
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS user_points (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(20) NOT NULL UNIQUE,
        username VARCHAR(100) NOT NULL,
        total_points INTEGER DEFAULT 0,
        entregas_count INTEGER DEFAULT 0,
        vip_count INTEGER DEFAULT 0,
        edicao_count INTEGER DEFAULT 0,
        encontrar_count INTEGER DEFAULT 0,
        recrutamento_count INTEGER DEFAULT 0,
        verificacao_count INTEGER DEFAULT 0,
        suporte_count INTEGER DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de histórico de pontos
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS points_history (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(20) NOT NULL,
        activity_type VARCHAR(50) NOT NULL,
        points_earned INTEGER NOT NULL,
        channel_id VARCHAR(20),
        message_id VARCHAR(20),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user_points(user_id) ON DELETE CASCADE
      )
    `);

    console.log('Tabelas do banco de dados inicializadas');
  } catch (error) {
    console.error('Erro ao inicializar banco de dados:', error);
  }
}

// Criar servidor HTTP
const app = express();

app.get('/', (req, res) => {
  res.send('Bot está vivo!');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Servidor web rodando na porta 3000');
});

// Configuração do cliente Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  rest: {
    timeout: 60000,
    retries: 3
  }
});

const conversaoEscolha = new Map();

// Funções para gerenciar threads ativas
async function hasActiveThread(userId) {
  try {
    const result = await pgClient.query(
      'SELECT thread_id, thread_type FROM active_threads WHERE user_id = $1',
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Erro ao verificar thread ativa:', error);
    return null;
  }
}

async function addActiveThread(userId, threadId, threadType) {
  try {
    await pgClient.query(
      'INSERT INTO active_threads (user_id, thread_id, thread_type) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET thread_id = $2, thread_type = $3, created_at = CURRENT_TIMESTAMP',
      [userId, threadId, threadType]
    );
  } catch (error) {
    console.error('Erro ao adicionar thread ativa:', error);
  }
}

async function removeActiveThread(userId) {
  try {
    await pgClient.query('DELETE FROM active_threads WHERE user_id = $1', [userId]);
  } catch (error) {
    console.error('Erro ao remover thread ativa:', error);
  }
}

async function isUserBlacklisted(userId) {
  try {
    const result = await pgClient.query(
      'SELECT reason FROM recruitment_blacklist WHERE user_id = $1',
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Erro ao verificar blacklist:', error);
    return null;
  }
}

async function addToBlacklist(userId, reason, addedBy) {
  try {
    await pgClient.query(
      'INSERT INTO recruitment_blacklist (user_id, reason, added_by) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET reason = $2, added_by = $3, added_at = CURRENT_TIMESTAMP',
      [userId, reason, addedBy]
    );
  } catch (error) {
    console.error('Erro ao adicionar à blacklist:', error);
    throw error;
  }
}

async function removeFromBlacklist(userId) {
  try {
    await pgClient.query('DELETE FROM recruitment_blacklist WHERE user_id = $1', [userId]);
  } catch (error) {
    console.error('Erro ao remover da blacklist:', error);
    throw error;
  }
}

async function getBlacklistUsers() {
  try {
    const result = await pgClient.query(
      'SELECT user_id, reason, added_by, added_at FROM recruitment_blacklist ORDER BY added_at DESC'
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao buscar blacklist:', error);
    return [];
  }
}

// Função para buscar estatísticas de desempenho do staff
async function getStaffPerformanceStats() {
  try {
    const result = await pgClient.query(`
      SELECT 
        staff_id,
        COUNT(*) as total_feedbacks,
        AVG(CASE 
          WHEN rating LIKE '%Excelente%' THEN 5
          WHEN rating LIKE '%Bom%' THEN 4
          WHEN rating LIKE '%Regular%' THEN 3
          WHEN rating LIKE '%Ruim%' THEN 2
          ELSE 3
        END) as avg_rating,
        COUNT(CASE WHEN rating LIKE '%Excelente%' THEN 1 END) as excelente_count,
        COUNT(CASE WHEN rating LIKE '%Bom%' THEN 1 END) as bom_count,
        COUNT(CASE WHEN rating LIKE '%Regular%' THEN 1 END) as regular_count,
        COUNT(CASE WHEN rating LIKE '%Ruim%' THEN 1 END) as ruim_count,
        COUNT(CASE WHEN is_automatic = true THEN 1 END) as automatic_count,
        thread_type,
        MAX(created_at) as last_feedback
      FROM staff_feedback 
      GROUP BY staff_id, thread_type
      ORDER BY avg_rating DESC, total_feedbacks DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('Erro ao buscar estatísticas de desempenho:', error);
    return [];
  }
}

// Função para buscar estatísticas gerais de um staff específico
async function getStaffIndividualStats(staffId) {
  try {
    const result = await pgClient.query(`
      SELECT 
        staff_id,
        COUNT(*) as total_feedbacks,
        AVG(CASE 
          WHEN rating LIKE '%Excelente%' THEN 5
          WHEN rating LIKE '%Bom%' THEN 4
          WHEN rating LIKE '%Regular%' THEN 3
          WHEN rating LIKE '%Ruim%' THEN 2
          ELSE 3
        END) as avg_rating,
        COUNT(CASE WHEN rating LIKE '%Excelente%' THEN 1 END) as excelente_count,
        COUNT(CASE WHEN rating LIKE '%Bom%' THEN 1 END) as bom_count,
        COUNT(CASE WHEN rating LIKE '%Regular%' THEN 1 END) as regular_count,
        COUNT(CASE WHEN rating LIKE '%Ruim%' THEN 1 END) as ruim_count,
        COUNT(CASE WHEN is_automatic = true THEN 1 END) as automatic_count
      FROM staff_feedback 
      WHERE staff_id = $1
      GROUP BY staff_id
    `, [staffId]);

    return result.rows[0] || null;
  } catch (error) {
    console.error('Erro ao buscar estatísticas individuais:', error);
    return null;
  }
}

// Funções para gerenciar posts no PostgreSQL

// Função para criar um novo post
async function createPost(postId, authorId, messageId = null) {
  try {
    await pgClient.query(
      'INSERT INTO instagram_posts (post_id, author_id, message_id) VALUES ($1, $2, $3)',
      [postId, authorId, messageId]
    );
    console.log(`Post criado no database: ${postId}`);
  } catch (error) {
    console.error('Erro ao criar post no database:', error);
    throw error;
  }
}

// Função para buscar dados de um post
async function getPost(postId) {
  try {
    const result = await pgClient.query(
      'SELECT * FROM instagram_posts WHERE post_id = $1',
      [postId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Erro ao buscar post:', error);
    return null;
  }
}

// Função para deletar um post
async function deletePost(postId) {
  try {
    await pgClient.query('DELETE FROM instagram_posts WHERE post_id = $1', [postId]);
    console.log(`Post deletado do database: ${postId}`);
  } catch (error) {
    console.error('Erro ao deletar post:', error);
    throw error;
  }
}

// Função para adicionar/remover like
async function toggleLike(postId, userId) {
  try {
    // Verificar se já existe like
    const existingLike = await pgClient.query(
      'SELECT id FROM post_likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (existingLike.rows.length > 0) {
      // Remover like
      await pgClient.query(
        'DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2',
        [postId, userId]
      );
      return { action: 'removed' };
    } else {
      // Adicionar like
      await pgClient.query(
        'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)',
        [postId, userId]
      );
      return { action: 'added' };
    }
  } catch (error) {
    console.error('Erro ao toggle like:', error);
    throw error;
  }
}

// Função para buscar likes de um post
async function getPostLikes(postId) {
  try {
    const result = await pgClient.query(
      'SELECT user_id FROM post_likes WHERE post_id = $1',
      [postId]
    );
    return result.rows.map(row => row.user_id);
  } catch (error) {
    console.error('Erro ao buscar likes:', error);
    return [];
  }
}

// Função para contar likes
async function countPostLikes(postId) {
  try {
    const result = await pgClient.query(
      'SELECT COUNT(*) as count FROM post_likes WHERE post_id = $1',
      [postId]
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Erro ao contar likes:', error);
    return 0;
  }
}

// Função para adicionar comentário
async function addComment(postId, userId, commentText) {
  try {
    // Verificar limite de comentários do usuário
    const userCountResult = await pgClient.query(
      'SELECT comment_count FROM user_comment_counts WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    const currentCount = userCountResult.rows.length > 0 ? userCountResult.rows[0].comment_count : 0;

    if (currentCount >= 2) {
      throw new Error('Limite de 2 comentários por usuário atingido');
    }

    // Adicionar comentário
    await pgClient.query(
      'INSERT INTO post_comments (post_id, user_id, comment_text) VALUES ($1, $2, $3)',
      [postId, userId, commentText]
    );

    // Atualizar contador
    await pgClient.query(`
      INSERT INTO user_comment_counts (post_id, user_id, comment_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (post_id, user_id)
      DO UPDATE SET comment_count = user_comment_counts.comment_count + 1
    `, [postId, userId]);

    console.log(`Comentário adicionado: ${postId} por ${userId}`);
  } catch (error) {
    console.error('Erro ao adicionar comentário:', error);
    throw error;
  }
}

// Função para buscar comentários de um post
async function getPostComments(postId) {
  try {
    const result = await pgClient.query(
      'SELECT user_id, comment_text, created_at FROM post_comments WHERE post_id = $1 ORDER BY created_at ASC',
      [postId]
    );
    return result.rows.map(row => ({
      userId: row.user_id,
      comment: row.comment_text,
      timestamp: row.created_at.getTime()
    }));
  } catch (error) {
    console.error('Erro ao buscar comentários:', error);
    return [];
  }
}

// Função para deletar comentário
async function deleteComment(postId, commentNumber) {
  try {
    // Buscar comentários ordenados
    const comments = await pgClient.query(
      'SELECT id, user_id FROM post_comments WHERE post_id = $1 ORDER BY created_at ASC',
      [postId]
    );

    if (commentNumber < 1 || commentNumber > comments.rows.length) {
      throw new Error('Número de comentário inválido');
    }

    const commentToDelete = comments.rows[commentNumber - 1];

    // Deletar comentário
    await pgClient.query('DELETE FROM post_comments WHERE id = $1', [commentToDelete.id]);

    // Atualizar contador
    await pgClient.query(
      'UPDATE user_comment_counts SET comment_count = comment_count - 1 WHERE post_id = $1 AND user_id = $2',
      [postId, commentToDelete.user_id]
    );

    console.log(`Comentário deletado: ${postId} - comentário ${commentNumber}`);
  } catch (error) {
    console.error('Erro ao deletar comentário:', error);
    throw error;
  }
}

// Função para atualizar configurações de privacidade
async function updatePostPrivacy(postId, commentsPrivate = null, likesPrivate = null) {
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (commentsPrivate !== null) {
      updates.push(`comments_private = $${paramIndex++}`);
      values.push(commentsPrivate);
    }

    if (likesPrivate !== null) {
      updates.push(`likes_private = $${paramIndex++}`);
      values.push(likesPrivate);
    }

    if (updates.length > 0) {
      values.push(postId);
      await pgClient.query(
        `UPDATE instagram_posts SET ${updates.join(', ')} WHERE post_id = $${paramIndex}`,
        values
      );
    }
  } catch (error) {
    console.error('Erro ao atualizar privacidade:', error);
    throw error;
  }
}

// Função para buscar configurações de privacidade
async function getPostPrivacy(postId) {
  try {
    const result = await pgClient.query(
      'SELECT comments_private, likes_private FROM instagram_posts WHERE post_id = $1',
      [postId]
    );
    return result.rows[0] || { comments_private: false, likes_private: false };
  } catch (error) {
    console.error('Erro ao buscar configurações de privacidade:', error);
    return { comments_private: false, likes_private: false };
  }
}

// Função para buscar todos os posts para estatísticas
async function getAllPostsStats() {
  try {
    const result = await pgClient.query(`
      SELECT 
        p.post_id,
        p.author_id,
        p.created_at,
        COUNT(DISTINCT l.user_id) as like_count,
        COUNT(DISTINCT c.id) as comment_count
      FROM instagram_posts p
      LEFT JOIN post_likes l ON p.post_id = l.post_id
      LEFT JOIN post_comments c ON p.post_id = c.post_id
      GROUP BY p.post_id, p.author_id, p.created_at
      ORDER BY p.created_at DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('Erro ao buscar estatísticas dos posts:', error);
    return [];
  }
}

// Funções para gerenciar curtidas do Twitter no PostgreSQL

// Função para adicionar/remover curtida do Twitter
async function toggleTwitterLike(postId, userId) {
  try {
    // Verificar se já existe curtida
    const existingLike = await pgClient.query(
      'SELECT id FROM twitter_likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (existingLike.rows.length > 0) {
      // Remover curtida
      await pgClient.query(
        'DELETE FROM twitter_likes WHERE post_id = $1 AND user_id = $2',
        [postId, userId]
      );
      return { action: 'removed' };
    } else {
      // Adicionar curtida
      await pgClient.query(
        'INSERT INTO twitter_likes (post_id, user_id) VALUES ($1, $2)',
        [postId, userId]
      );
      return { action: 'added' };
    }
  } catch (error) {
    console.error('Erro ao toggle curtida Twitter:', error);
    throw error;
  }
}

// Função para contar curtidas do Twitter
async function countTwitterLikes(postId) {
  try {
    const result = await pgClient.query(
      'SELECT COUNT(*) as count FROM twitter_likes WHERE post_id = $1',
      [postId]
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Erro ao contar curtidas Twitter:', error);
    return 0;
  }
}

// Funções para gerenciar pontos no PostgreSQL

// Função para adicionar pontos multi-servidor (sem verificação de cargo)
async function addMultiServerPoints(userId, username, activityType, points, channelId = null, messageId = null, description = null) {
  try {
    // Garantir que o usuário existe na tabela
    await createOrUpdateUserPoints(userId, username);

    // Adicionar ao histórico
    await pgClient.query(`
      INSERT INTO points_history (user_id, activity_type, points_earned, channel_id, message_id, description)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, activityType, points, channelId, messageId, description]);

    // Atualizar contadores baseado no tipo de atividade
    let updateQuery = 'UPDATE user_points SET total_points = total_points + $1, last_updated = CURRENT_TIMESTAMP';
    let updateParams = [points, userId];

    switch(activityType) {
      case 'entregas':
        updateQuery += ', entregas_count = entregas_count + 1';
        break;
      case 'vip':
        updateQuery += ', vip_count = vip_count + 1';
        break;
      case 'edicao':
        updateQuery += ', edicao_count = edicao_count + 1';
        break;
      case 'encontrar':
        updateQuery += ', encontrar_count = encontrar_count + 1';
        break;
      case 'recrutamento':
        updateQuery += ', recrutamento_count = recrutamento_count + 1';
        break;
      case 'verificacao':
        updateQuery += ', verificacao_count = verificacao_count + 1';
        break;
      case 'suporte':
        updateQuery += ', suporte_count = suporte_count + 1';
        break;
    }

    updateQuery += ' WHERE user_id = $2';
    await pgClient.query(updateQuery, updateParams);

    console.log(`Pontos multi-servidor: ${username} (+${points} pontos por ${activityType})`);
  } catch (error) {
    console.error('Erro ao adicionar pontos multi-servidor:', error);
    throw error;
  }
}

// Função para criar ou atualizar usuário na tabela de pontos
async function createOrUpdateUserPoints(userId, username) {
  try {
    await pgClient.query(`
      INSERT INTO user_points (user_id, username) 
      VALUES ($1, $2) 
      ON CONFLICT (user_id) 
      DO UPDATE SET username = $2, last_updated = CURRENT_TIMESTAMP
    `, [userId, username]);
  } catch (error) {
    console.error('Erro ao criar/atualizar usuário de pontos:', error);
  }
}

// Função para adicionar pontos
async function addPoints(userId, username, activityType, points, channelId = null, messageId = null, description = null) {
  try {
    // Garantir que o usuário existe na tabela
    await createOrUpdateUserPoints(userId, username);

    // Adicionar ao histórico
    await pgClient.query(`
      INSERT INTO points_history (user_id, activity_type, points_earned, channel_id, message_id, description)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, activityType, points, channelId, messageId, description]);

    // Atualizar contadores baseado no tipo de atividade
    let updateQuery = 'UPDATE user_points SET total_points = total_points + $1, last_updated = CURRENT_TIMESTAMP';
    let updateParams = [points, userId];

    switch(activityType) {
      case 'entregas':
        updateQuery += ', entregas_count = entregas_count + 1';
        break;
      case 'vip':
        updateQuery += ', vip_count = vip_count + 1';
        break;
      case 'edicao':
        updateQuery += ', edicao_count = edicao_count + 1';
        break;
      case 'encontrar':
        updateQuery += ', encontrar_count = encontrar_count + 1';
        break;
      case 'recrutamento':
        updateQuery += ', recrutamento_count = recrutamento_count + 1';
        break;
      case 'verificacao':
        updateQuery += ', verificacao_count = verificacao_count + 1';
        break;
      case 'suporte':
        updateQuery += ', suporte_count = suporte_count + 1';
        break;
    }

    updateQuery += ' WHERE user_id = $2';
    await pgClient.query(updateQuery, updateParams);

    console.log(`Pontos adicionados: ${username} (+${points} pontos por ${activityType})`);
  } catch (error) {
    console.error('Erro ao adicionar pontos:', error);
    throw error;
  }
}

// Função para buscar pontos de um usuário
async function getUserPoints(userId) {
  try {
    const result = await pgClient.query(`
      SELECT * FROM user_points WHERE user_id = $1
    `, [userId]);

    return result.rows[0] || null;
  } catch (error) {
    console.error('Erro ao buscar pontos do usuário:', error);
    return null;
  }
}

// Função para buscar ranking de pontos
async function getPointsRanking(limit = 10) {
  try {
    const result = await pgClient.query(`
      SELECT user_id, username, total_points, 
             entregas_count, vip_count, edicao_count, encontrar_count,
             recrutamento_count, verificacao_count, suporte_count,
             last_updated
      FROM user_points 
      ORDER BY total_points DESC, last_updated DESC 
      LIMIT $1
    `, [limit]);

    return result.rows;
  } catch (error) {
    console.error('Erro ao buscar ranking de pontos:', error);
    return [];
  }
}

// Função para buscar histórico de pontos de um usuário
async function getUserPointsHistory(userId, limit = 20) {
  try {
    const result = await pgClient.query(`
      SELECT activity_type, points_earned, description, created_at
      FROM points_history 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `, [userId, limit]);

    return result.rows;
  } catch (error) {
    console.error('Erro ao buscar histórico de pontos:', error);
    return [];
  }
}

// Função para resetar pontos de um usuário (apenas admins)
async function resetUserPoints(userId) {
  try {
    await pgClient.query(`
      UPDATE user_points 
      SET total_points = 0, entregas_count = 0, vip_count = 0, 
          edicao_count = 0, encontrar_count = 0, recrutamento_count = 0,
          verificacao_count = 0, suporte_count = 0, last_updated = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `, [userId]);

    await pgClient.query(`
      DELETE FROM points_history WHERE user_id = $1
    `, [userId]);

    console.log(`Pontos resetados para usuário: ${userId}`);
  } catch (error) {
    console.error('Erro ao resetar pontos:', error);
    throw error;
  }
}

// Maps temporários para compatibilidade (serão removidos gradualmente)
const postLikes = new Map();
const postComments = new Map();
const postAuthors = new Map();
const postPrivacySettings = new Map();
const userCommentCount = new Map();

// Sistema de inatividade para threads do conversor
const threadInactivityTimers = new Map(); // threadId -> { firstTimer, secondTimer }
const threadWarningMessages = new Map(); // threadId -> messageId

console.log('Sistema de posts PostgreSQL inicializado');

// Função para criar postagem no estilo Twitter
async function criarPostagemTwitter(autor, texto, mencionar, anonimo, modoEscuro = false) {
  const canvas = createCanvas(600, 400);
  const ctx = canvas.getContext('2d');

  // Fundo baseado no modo
  ctx.fillStyle = modoEscuro ? '#15202b' : '#ffffff';
  ctx.fillRect(0, 0, 600, 400);

  // Borda sutil
  ctx.strokeStyle = '#e1e8ed';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, 600, 400);

  try {
    let avatarUrl, displayName;

    if (anonimo) {
      // Usuário anônimo
      avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
      displayName = 'Usuário Anônimo';
    } else {
      // Usuário real
      avatarUrl = autor.displayAvatarURL({ extension: 'png', size: 128 });
      displayName = autor.displayName || autor.username;
    }

    // Carregar avatar
    const avatar = await loadImage(avatarUrl);

    // Desenhar avatar (circular)
    ctx.save();
    ctx.beginPath();
    ctx.arc(50, 50, 25, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 25, 25, 50, 50);
    ctx.restore();

    // Nome do usuário
    ctx.fillStyle = modoEscuro ? '#ffffff' : '#14171a';
    ctx.font = 'bold 16px "Arial Bold"';
    ctx.fillText(displayName, 90, 45);

    // Handle do usuário (se não for anônimo)
    if (!anonimo) {
      ctx.fillStyle = modoEscuro ? '#8899a6' : '#657786';
      ctx.font = '14px "Arial Bold"';
      ctx.fillText(`@${autor.username}`, 90, 65);
    }

    // Texto da postagem
    ctx.fillStyle = modoEscuro ? '#ffffff' : '#14171a';
    ctx.font = '18px "Arial Bold"';

    // Quebrar texto em linhas
    const linhas = quebrarTexto(ctx, texto, 480);
    let yPos = 120;

    linhas.forEach(linha => {
      ctx.fillText(linha, 30, yPos);
      yPos += 25;
    });

    // Mencionar usuário (se houver)
    if (mencionar) {
      yPos += 20;

      // Linha de separação
      ctx.strokeStyle = modoEscuro ? '#38444d' : '#e1e8ed';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, yPos);
      ctx.lineTo(570, yPos);
      ctx.stroke();

      yPos += 30;

      try {
        // Avatar do mencionado
        const mencionadoAvatar = await loadImage(mencionar.displayAvatarURL({ extension: 'png', size: 64 }));

        ctx.save();
        ctx.beginPath();
        ctx.arc(50, yPos + 15, 15, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(mencionadoAvatar, 35, yPos, 30, 30);
        ctx.restore();

        // Nome do mencionado
        ctx.fillStyle = '#1da1f2';
        ctx.font = 'bold 14px "Arial Bold"';
        ctx.fillText(`@${mencionar.displayName || mencionar.username}`, 80, yPos + 20);
      } catch (error) {
        console.error('Erro ao carregar avatar do mencionado:', error);
        // Fallback sem avatar
        ctx.fillStyle = '#1da1f2';
        ctx.font = 'bold 14px "Arial Bold"';
        ctx.fillText(`@${mencionar.displayName || mencionar.username}`, 30, yPos + 20);
      }
    }

    // Linha inferior
    const bottomY = 350;
    ctx.strokeStyle = modoEscuro ? '#38444d' : '#e1e8ed';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, bottomY);
    ctx.lineTo(570, bottomY);
    ctx.stroke();

    // Timestamp com fuso horário de Brasília
    const agora = new Date();
    const timestamp = agora.toLocaleString('pt-BR', { 
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });

    ctx.fillStyle = modoEscuro ? '#8899a6' : '#657786';
    ctx.font = '12px "Arial Bold"';
    ctx.fillText(timestamp, 450, bottomY + 25);

    return canvas.toBuffer('image/png');

  } catch (error) {
    console.error('Erro ao criar canvas da postagem:', error);
    throw error;
  }
}

// Função auxiliar para quebrar texto em linhas
function quebrarTexto(ctx, texto, larguraMaxima) {
  const palavras = texto.split(' ');
  const linhas = [];
  let linhaAtual = '';

  palavras.forEach(palavra => {
    const testeLinhaAtual = linhaAtual + (linhaAtual ? ' ' : '') + palavra;
    const largura = ctx.measureText(testeLinhaAtual).width;

    if (largura > larguraMaxima && linhaAtual) {
      linhas.push(linhaAtual);
      linhaAtual = palavra;
    } else {
      linhaAtual = testeLinhaAtual;
    }
  });

  if (linhaAtual) {
    linhas.push(linhaAtual);
  }

  return linhas;
}

// Funções para sistema de inatividade nas threads do conversor
function startInactivityTimer(threadId, userId) {
  // Limpar timers existentes se houver
  clearInactivityTimer(threadId);

  const firstTimeout = setTimeout(async () => {
    try {
      const thread = client.channels.cache.get(threadId);
      if (!thread || thread.archived || thread.locked) return;

      const warningEmbed = new EmbedBuilder()
        .setTitle(' **THREAD INATIVA**')
        .setDescription(`
**Ei, ainda está aí?**

Sua thread de conversão está inativa há 5 minutos.

>  *Se você não responder em 3 minutos, a thread será encerrada automaticamente para otimizar o servidor.*
`)
        .setColor('#ffaa00')
        .setTimestamp();

      const encerrarButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('encerrar_thread_inativo')
          .setLabel('Encerrar Thread')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger)
      );

      const warningMessage = await thread.send({
        content: `<@${userId}>`,
        embeds: [warningEmbed],
        components: [encerrarButton]
      });

      // Salvar ID da mensagem de aviso
      threadWarningMessages.set(threadId, warningMessage.id);

      // Iniciar segundo timer (3 minutos para encerramento automático)
      const secondTimeout = setTimeout(async () => {
        try {
          const threadCheck = client.channels.cache.get(threadId);
          if (!threadCheck || threadCheck.archived || threadCheck.locked) return;

          const autoCloseEmbed = new EmbedBuilder()
            .setTitle(' **THREAD ENCERRADA AUTOMATICAMENTE**')
            .setDescription(`
**Thread encerrada por inatividade**

Esta thread foi automaticamente encerrada após 8 minutos de inatividade total.

**Motivo:** Otimização do servidor
**Encerrado em:** ${new Date().toLocaleString('pt-BR')}

>  *Você pode abrir uma nova thread de conversão a qualquer momento.*
`)
            .setColor('#ff4444')
            .setFooter({ text: 'GIFZADA CONVERSOR • Encerramento Automático' })
            .setTimestamp();

          await threadCheck.send({ embeds: [autoCloseEmbed] });

          // Aguardar 2 segundos antes de trancar e arquivar
          setTimeout(async () => {
            try {
              await threadCheck.setLocked(true);
              await threadCheck.setArchived(true);

              // Limpar dados da thread
              clearInactivityTimer(threadId);
              conversaoEscolha.delete(threadId);
            } catch (lockError) {
              console.error('Erro ao trancar thread por inatividade:', lockError);
            }
          }, 2000);

        } catch (error) {
          console.error('Erro no encerramento automático por inatividade:', error);
        }
      }, 3 * 60 * 1000); // 3 minutos

      // Salvar o segundo timer
      const timers = threadInactivityTimers.get(threadId) || {};
      timers.secondTimer = secondTimeout;
      threadInactivityTimers.set(threadId, timers);

    } catch (error) {
      console.error('Erro no aviso de inatividade:', error);
    }
  }, 5 * 60 * 1000); // 5 minutos

  // Salvar o primeiro timer
  threadInactivityTimers.set(threadId, { firstTimer: firstTimeout });
}

function clearInactivityTimer(threadId) {
  const timers = threadInactivityTimers.get(threadId);
  if (timers) {
    if (timers.firstTimer) clearTimeout(timers.firstTimer);
    if (timers.secondTimer) clearTimeout(timers.secondTimer);
    threadInactivityTimers.delete(threadId);
  }
  threadWarningMessages.delete(threadId);
}

function resetInactivityTimer(threadId, userId) {
  // Limpar timers existentes e iniciar novo timer
  clearInactivityTimer(threadId);
  startInactivityTimer(threadId, userId);
}

// Maps para sistema de verificação
const activeVerificationThreads = new Map(); // userId -> threadId
const blockedVerificationUsers = new Set(); // userIds bloqueados

client.once('ready', async () => {
  console.log(`Logado como ${client.user.tag}`);

  // Importar gifsicle dinamicamente
  try {
    const gifsicleModule = await import('gifsicle');
    gifsicle = gifsicleModule.default;
    console.log('Gifsicle importado com sucesso');
  } catch (error) {
    console.error('Erro ao importar gifsicle:', error);
  }

  // Registrar comandos slas
  const commands = [
    {
      name: 'lock',
      description: 'Bloqueia o canal atual para apenas administradores',
    },
    {
      name: 'unlock',
      description: 'Desbloqueia o canal atual para todos os membros',
    },
    {
      name: 'rec-staff',
      description: 'Adiciona cargos de maker ao usuário',
      options: [
        {
          name: 'usuario',
          type: 6, // USER
          description: 'O usuário a ser recrutado como maker',
          required: true,
        },
      ],
    },
    {
      name: 'rec-postador',
      description: 'Adiciona cargo de postador ao usuário',
      options: [
        {
          name: 'usuario',
          type: 6, // USER
          description: 'O usuário a ser recrutado como postador',
          required: true,
        },
      ],
    },
    {
      name: 'postar',
      description: 'Cria uma postagem no estilo Twitter',
      options: [
        {
          name: 'texto',
          type: 3, // STRING
          description: 'O texto da postagem',
          required: true,
        },
        {
          name: 'mencionar',
          type: 6, // USER
          description: 'Usuário para mencionar na postagem',
          required: false,
        },
        {
          name: 'anonimo',
          type: 5, // BOOLEAN
          description: 'Postar como anônimo (oculta quem fez a postagem)',
          required: false,
        },
        {
          name: 'modo_escuro',
          type: 5, // BOOLEAN
          description: 'Usar fundo escuro na postagem',
          required: false,
        },
      ],
    },
    {
      name: 'solicitarban',
      description: 'Solicita o banimento de um usuário',
      options: [
        {
          name: 'usuario',
          type: 6, // USER
          description: 'ID do usuário para banir',
          required: true,
        },
        {
          name: 'anexo',
          type: 11, // ATTACHMENT
          description: 'Prova/evidência para o banimento',
          required: true,
        },
        {
          name: 'motivo',
          type: 3, // STRING
          description: 'Motivo do banimento',
          required: true,
        },
      ],
    },
  ];

  try {
    await client.application.commands.set(commands);
    console.log('Comandos slash registrados com sucesso!');
  } catch (error) {
    console.error('Erro ao registrar comandos slash:', error);
  }

  // Configuração dos canais com horários
  const canalHorarios = [
    { id: '1347306776952836197', abre: '14:00', fecha: '20:00' },
    { id: '1298115750665650176', abre: '14:00', fecha: '21:00' },
    { id: '1065441938695802960', abre: '14:00', fecha: '21:00' },
    { id: '1065441942109945877', abre: '12:00', fecha: '22:00' }
  ];

  // Função para gerenciar canal com verificação de estado atual
  async function gerenciarCanalComVerificacao(channelId, acao, horario) {
    try {
      const channel = client.channels.cache.get(channelId);

      if (!channel) {
        console.log(`Canal ${channelId} não encontrado`);
        return;
      }

      const everyonePermissions = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);

      if (acao === 'fechar') {
        // Verificar se já está bloqueado (fechado manualmente)
        const isAlreadyLocked = everyonePermissions && everyonePermissions.deny.has('SendMessages');

        if (isAlreadyLocked) {
          console.log(`Canal ${channel.name} já está bloqueado (possivelmente fechado manualmente) - não executando fechamento automático`);
          return;
        }

        // Se não está bloqueado, executar fechamento automático
        await gerenciarCanal(channelId, acao, horario);
      }

      if (acao === 'abrir') {
        // Verificar se já está desbloqueado (aberto manualmente ou já aberto)
        const isAlreadyUnlocked = !everyonePermissions || !everyonePermissions.deny.has('SendMessages');

        if (isAlreadyUnlocked) {
          console.log(`Canal ${channel.name} já está desbloqueado (possivelmente aberto manualmente) - não executando abertura automática`);
          return;
        }

        // Se está bloqueado, executar abertura automática
        await gerenciarCanal(channelId, acao, horario);
      }

    } catch (error) {
      console.error(`Erro ao verificar canal antes de ${acao}:`, error);
    }
  }

  // Função para abrir/fechar canais
  async function gerenciarCanal(channelId, acao, horario) {
    try {
      const channel = client.channels.cache.get(channelId);

      if (!channel) {
        console.log(`Canal ${channelId} não encontrado`);
        return;
      }

      if (acao === 'abrir') {
        // Verificar se já está desbloqueado
        const everyonePermissions = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
        const isAlreadyUnlocked = !everyonePermissions || !everyonePermissions.deny.has('SendMessages');

        if (isAlreadyUnlocked) {
          console.log(`Canal ${channel.name} já está desbloqueado`);
          return;
        }

        // Desbloquear o canal com permissões explícitas
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
          SendMessages: true,
          AddReactions: true,
          CreatePublicThreads: true,
          CreatePrivateThreads: true
        });

        // Encontrar horário de fechamento do canal
        const canalInfo = canalHorarios.find(c => c.id === channelId);
        const horarioFechamento = canalInfo ? canalInfo.fecha : 'horário programado';

        await channel.send(`<:a_gifzada:1266774740115132468> **Aberto!**\nEstaremos aberto até às **${horarioFechamento}h (BRT)**.`);
        console.log(`Canal ${channel.name} foi automaticamente desbloqueado às ${horario}`);

      } else if (acao === 'fechar') {
        // Verificar se já está bloqueado
        const everyonePermissions = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
        const isAlreadyLocked = everyonePermissions && everyonePermissions.deny.has('SendMessages');

        if (isAlreadyLocked) {
          console.log(`Canal ${channel.name} já está bloqueado`);
          return;
        }

        // Bloquear o canal
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
          SendMessages: false,
          AddReactions: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false
        });

        // Encontrar horário de abertura do canal
        const canalInfo = canalHorarios.find(c => c.id === channelId);
        const horarioAbertura = canalInfo ? canalInfo.abre : 'horário programado';

        await channel.send(`<:a_gifzada:1266774740115132468> **Fechado!**\nAbriremos novamente amanhã às **${horarioAbertura}h (BRT)**.`);
        console.log(`Canal ${channel.name} foi automaticamente bloqueado às ${horario}`);
      }

    } catch (error) {
      console.error(`Erro ao ${acao} canal automaticamente:`, error);
    }
  }

  // Configurar agendamentos para cada canal - executa apenas no minuto 06
  canalHorarios.forEach(canal => {
    const [horaAbre, minutoAbre] = canal.abre.split(':');
    const [horaFecha, minutoFecha] = canal.fecha.split(':');

    // Agendamento para abrir o canal - só executa se o minuto atual for 06 E se não já estiver aberto
    cron.schedule(`6 ${horaAbre} * * *`, async () => {
      await gerenciarCanalComVerificacao(canal.id, 'abrir', canal.abre);
    }, {
      timezone: "America/Sao_Paulo"
    });

    // Agendamento para fechar o canal - só executa se o minuto atual for 06 E se não foi fechado manualmente
    cron.schedule(`6 ${horaFecha} * * *`, async () => {
      await gerenciarCanalComVerificacao(canal.id, 'fechar', canal.fecha);
    }, {
      timezone: "America/Sao_Paulo"
    });

    console.log(`Agendamento configurado para canal ${canal.id}: abre ${canal.abre}:06, fecha ${canal.fecha}:06`);
  });

  console.log('Sistema de agendamento automático configurado para todos os canais');

  // Agendamento para postagem mais curtida da semana - todo sábado às 18:00 (BRT)
  cron.schedule('0 18 * * 6', async () => {
    await anunciarPostMaisCurtidaDaSemana();
  }, {
    timezone: "America/Sao_Paulo"
  });

  console.log('Sistema de anúncio da postagem mais curtida da semana configurado para sábados às 18:00 (BRT)');

  // Agendamento para verificação de perfis /gifs - todo sábado às 10:00 (BRT)
  cron.schedule('0 10 * * 6', async () => {
    await verificarPerfilsGifs();
  }, {
    timezone: "America/Sao_Paulo"
  });

  console.log('Sistema de verificação de perfis /gifs configurado para sábados às 10:00 (BRT)');
});

// Mapa para controlar cooldown de menções
const staffMentionCooldown = new Map();

// Mapa para controlar quem assumiu cada verificação
const verificationAssignments = new Map();

// Sistema de feedback obrigatório
const feedbackTimers = new Map(); // threadId -> timeoutId
const threadAssignments = new Map(); // threadId -> { staffId, userId, threadType }
const feedbackGiven = new Set(); // threadId - para rastrear quais threads já receberam feedback

// Função para iniciar sistema de feedback obrigatório
async function startFeedbackSystem(interaction, assignment) {
  const { staffId, userId, threadType } = assignment;
  const threadId = interaction.channel.id;

  try {
    const staffUser = await client.users.fetch(staffId);
    const user = await client.users.fetch(userId);

    // Embed solicitando feedback
    const feedbackEmbed = new EmbedBuilder()
      .setTitle('⭐ AVALIAÇÃO DO ATENDIMENTO')
      .setDescription(`
${user}, **seu ticket foi finalizado!**

**Staff responsável:** ${staffUser}
**Tipo de atendimento:** ${threadType.charAt(0).toUpperCase() + threadType.slice(1)}

**Por favor, avalie o atendimento que você recebeu:**
`)
      .setColor('#ffaa00')
      .setTimestamp();

    // Botões de feedback
    const feedbackRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`feedback_excelente_${threadId}`)
        .setLabel('Excelente')
        .setEmoji('⭐')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`feedback_bom_${threadId}`)
        .setLabel('Bom')
        .setEmoji('👍')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`feedback_regular_${threadId}`)
        .setLabel('Regular')
        .setEmoji('👌')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`feedback_ruim_${threadId}`)
        .setLabel('Ruim')
        .setEmoji('👎')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ 
      content: `${user}`, 
      embeds: [feedbackEmbed], 
      components: [feedbackRow] 
    });

    // Configurar timeout de 5 minutos para feedback automático
    const timeoutId = setTimeout(async () => {
      await handleAutoFeedback(threadId, assignment);
    }, 5 * 60 * 1000); // 5 minutos

    feedbackTimers.set(threadId, timeoutId);

  } catch (error) {
    console.error('Erro ao iniciar sistema de feedback:', error);
    // Em caso de erro, fechar normalmente
    await finalizarTicket(interaction, assignment);
  }
}

// Função para lidar com feedback automático
async function handleAutoFeedback(threadId, assignment) {
  const { staffId, userId, threadType } = assignment;

  // Verificar se o feedback já foi dado
  if (feedbackGiven.has(threadId)) {
    return;
  }

  try {
    const channel = client.channels.cache.get(threadId);
    if (!channel) return;

    const staffUser = await client.users.fetch(staffId);
    const user = await client.users.fetch(userId);

    // Registrar feedback automático como "Bom"
    await registerFeedback(threadId, 'auto', 'Bom (automático)', assignment);

    const autoFeedbackEmbed = new EmbedBuilder()
      .setTitle('⏰ FEEDBACK AUTOMÁTICO REGISTRADO')
      .setDescription(`
**Tempo limite atingido!**

Como ${user} não forneceu feedback dentro de 5 minutos, um feedback automático foi registrado:

**Staff:** ${staffUser}
**Avaliação:** Bom (automático)
**Motivo:** Usuário não respondeu no tempo limite

Thread será fechada automaticamente...
`)
      .setColor('#ffaa00')
      .setTimestamp();

    await channel.send({ embeds: [autoFeedbackEmbed] });

    // Fechar thread após 3 segundos
    setTimeout(async () => {
      await finalizarTicket(null, assignment, channel);
    }, 3000);

  } catch (error) {
    console.error('Erro no feedback automático:', error);
  }
}

// Função para registrar feedback
async function registerFeedback(threadId, userId, rating, assignment) {
  const { staffId, threadType } = assignment;

  try {
    const staffUser = await client.users.fetch(staffId);
    const user = userId === 'auto' ? { username: 'Sistema Automático' } : await client.users.fetch(userId);
    const isAutomatic = userId === 'auto';

    console.log(`Feedback registrado: Staff ${staffUser.username} recebeu avaliação "${rating}" de ${user.username} no atendimento ${threadType}`);

    // Salvar feedback no banco de dados
    await pgClient.query(
      'INSERT INTO staff_feedback (staff_id, user_id, rating, thread_type, thread_id, is_automatic) VALUES ($1, $2, $3, $4, $5, $6)',
      [staffId, userId === 'auto' ? '0' : userId, rating, threadType, threadId, isAutomatic]
    );

    feedbackGiven.add(threadId);

  } catch (error) {
    console.error('Erro ao registrar feedback:', error);
  }
}

// Função para finalizar ticket
async function finalizarTicket(interaction, assignment, channel = null) {
  const targetChannel = channel || interaction.channel;
  const threadId = targetChannel.id;

  try {
    // Limpar timers e registros
    if (feedbackTimers.has(threadId)) {
      clearTimeout(feedbackTimers.get(threadId));
      feedbackTimers.delete(threadId);
    }
    threadAssignments.delete(threadId);
    feedbackGiven.delete(threadId);

    // Se for ticket de maker, enviar para apadrinhamento
    if (assignment.threadType === 'maker') {
      try {
        // Buscar as informações do maker na thread
        const messages = await targetChannel.messages.fetch({ limit: 10 });
        const makerMessage = messages.find(msg => msg.embeds.length > 0 && msg.embeds[0].title?.includes('SEJA MAKER'));

        if (makerMessage && makerMessage.embeds[0]) {
          const embed = makerMessage.embeds[0];
          const description = embed.description;

          // Extrair informações da descrição
          const nomeMatch = description.match(/\*\*Nome:\*\*\s*(.+)/);
          const idadeMatch = description.match(/\*\*Idade:\*\*\s*(.+)/);
          const foiMakerMatch = description.match(/\*\*Já foi maker de outro servidor de GIFS\?\*\*\s*(.+)/);
          const objetivoMatch = description.match(/\*\*Objetivo a alcançar:\*\*\s*(.+)/);

          const nome = nomeMatch ? nomeMatch[1].trim() : 'Não informado';
          const idade = idadeMatch ? idadeMatch[1].trim() : 'Não informado';
          const foiMaker = foiMakerMatch ? foiMakerMatch[1].trim() : 'Não informado';
          const objetivo = objetivoMatch ? objetivoMatch[1].trim() : 'Não informado';

          // Canal de apadrinhamento
          const apadrinhamentoChannel = client.channels.cache.get('1231658019356672020');

          if (apadrinhamentoChannel) {
            const apadrinhamentoEmbed = new EmbedBuilder()
              .setTitle('<:1266777381188931726:1266777381188931726> | GIFZADA - APADRINHAMENTO')
              .setDescription(`
╭ ┈<:d_arrow:1366582051507273728> Seu trabalho agora é apadrinhar esse maker, fazendo com que ele saiba de todas as informações que precisa saber.

**Nome:**
${nome}
**Idade:**
${idade}
**Já foi maker de outro servidor de GIFS?**
${foiMaker}
**Objetivo a alcançar:**
${objetivo}
`)
              .setColor('#9c41ff')
              .setTimestamp();

            const apadrinhamentoButton = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('apadrinhar_maker')
                .setLabel('Apadrinhar')
                .setStyle(ButtonStyle.Success)
            );

            await apadrinhamentoChannel.send({
              content: `<@&1094385139976507523>`,
              embeds: [apadrinhamentoEmbed],
              components: [apadrinhamentoButton]
            });
          }
        }
      } catch (error) {
        console.error('Erro ao enviar apadrinhamento:', error);
      }
    }

    // Arquivar thread
    await targetChannel.setArchived(true);

    // Remover thread ativa do banco
    if (assignment.userId) {
      await removeActiveThread(assignment.userId);
    }

  } catch (error) {
    console.error('Erro ao finalizar ticket:', error);
  }
}

// Função para verificar perfis /gifs automaticamente
async function verificarPerfilsGifs() {
  try {
    console.log('Iniciando verificação automática de perfis /gifs...');

    // Buscar todos os usuários que usaram o comando !gifs
    const result = await pgClient.query('SELECT user_id, username FROM gifs_users');
    const gifsUsers = result.rows;

    if (gifsUsers.length === 0) {
      console.log('Nenhum usuário para verificar.');
      return;
    }

    const guild = client.guilds.cache.get('953748240589787136'); // ID do servidor principal
    if (!guild) {
      console.log('Servidor principal não encontrado');
      return;
    }

    const gifsRoleId = '1399533593360990421';
    let removidos = 0;
    let mantidos = 0;
    let erros = 0;
    const relatorio = [];

    for (const userData of gifsUsers) {
      try {
        // Buscar o usuário no Discord
        const user = await client.users.fetch(userData.user_id);
        const member = await guild.members.fetch(userData.user_id).catch(() => null);

        if (!member) {
          // Usuário não está mais no servidor, remover da tabela
          await pgClient.query('DELETE FROM gifs_users WHERE user_id = $1', [userData.user_id]);
          relatorio.push(`${userData.username} - Removido da tabela (não está no servidor)`);
          continue;
        }

        // Verificar se o usuário ainda tem /gifs na descrição/bio do perfil
        const fetchedUser = await client.users.fetch(userData.user_id, { force: true });
        const userBio = fetchedUser.bio || '';
        const hasGifsInProfile = userBio.includes('/gifs');

        // Atualizar status no banco
        await pgClient.query(
          'UPDATE gifs_users SET last_checked = CURRENT_TIMESTAMP, has_gifs_in_profile = $1 WHERE user_id = $2',
          [hasGifsInProfile, userData.user_id]
        );

        if (!hasGifsInProfile) {
          // Usuário não tem mais /gifs no perfil, remover cargo
          if (member.roles.cache.has(gifsRoleId)) {
            await member.roles.remove(gifsRoleId);
            console.log(`Cargo /gifs removido de ${user.username} (${user.id})`);
          }

          // Remover da tabela
          await pgClient.query('DELETE FROM gifs_users WHERE user_id = $1', [userData.user_id]);
          relatorio.push(`${userData.username} - Cargo removido (sem /gifs no perfil)`);
          removidos++;
        } else {
          relatorio.push(`${userData.username} - Mantido (tem /gifs no perfil)`);
          mantidos++;
        }

        // Delay entre verificações para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Erro ao verificar usuário ${userData.username}:`, error);
        relatorio.push(`${userData.username} - Erro na verificação`);
        erros++;
      }
    }

    // Enviar relatório no canal de logs (caso exista)
    const logChannelId = '1218390839722639461'; // Canal de suporte como exemplo
    const logChannel = client.channels.cache.get(logChannelId);

    if (logChannel) {
      const relatorioEmbed = new EmbedBuilder()
        .setTitle('📊 RELATÓRIO DE VERIFICAÇÃO /GIFS')
        .setDescription(`
**Verificação automática realizada com sucesso!**

**📈 ESTATÍSTICAS:**
• **Verificados:** ${gifsUsers.length} usuários
• **Cargos removidos:** ${removidos}
• **Cargos mantidos:** ${mantidos} 
• **Erros:** ${erros}

**📋 DETALHAMENTO:**
${relatorio.slice(0, 20).join('\n')}
${relatorio.length > 20 ? `\n*... e mais ${relatorio.length - 20} verificações*` : ''}

**Data:** ${new Date().toLocaleString('pt-BR')}
`)
        .setColor('#4169e1')
        .setFooter({ text: 'SISTEMA DE VERIFICAÇÃO /GIFS' })
        .setTimestamp();

      await logChannel.send({ embeds: [relatorioEmbed] });
    }

    console.log(`Verificação concluída: ${removidos} removidos, ${mantidos} mantidos, ${erros} erros`);

  } catch (error) {
    console.error('Erro na verificação automática de perfis /gifs:', error);
  }
}

// Variável para controlar o usuário atual com cargo de destaque
let currentHighlightUserId = null;

// Função para anunciar a postagem mais curtida da semana
async function anunciarPostMaisCurtidaDaSemana() {
  try {
    const canalPostsId = '1392228130361708645'; // Canal onde os posts são feitos
    const canalAnuncioId = '1395858254176849960'; // Canal onde será anunciado o destaque
    const cargoDestaqueId = '1298128245694402630'; // Cargo de destaque da semana

    const canal = client.channels.cache.get(canalPostsId);
    const canalAnuncio = client.channels.cache.get(canalAnuncioId);

    if (!canal) {
      console.log('Canal de posts não encontrado');
      return;
    }

    if (!canalAnuncio) {
      console.log('Canal de anúncio do destaque não encontrado');
      return;
    }

    // Buscar posts da última semana no database
    const umaSemanaAtras = new Date();
    umaSemanaAtras.setDate(umaSemanaAtras.getDate() - 7);

    const result = await pgClient.query(`
      SELECT 
        p.post_id,
        p.author_id,
        p.created_at,
        COUNT(l.user_id) as like_count
      FROM instagram_posts p
      LEFT JOIN post_likes l ON p.post_id = l.post_id
      WHERE p.created_at >= $1
      GROUP BY p.post_id, p.author_id, p.created_at
      ORDER BY like_count DESC, p.created_at DESC
      LIMIT 1
    `, [umaSemanaAtras]);

    if (result.rows.length === 0) {
      console.log('Nenhuma postagem encontrada na última semana');
      return;
    }

    const topPost = result.rows[0];
    const maisCurtidas = parseInt(topPost.like_count);
    const postMaisCurtido = topPost.post_id;
    const autorMaisCurtido = topPost.author_id;

    if (!postMaisCurtido || maisCurtidas === 0) {
      console.log('Nenhuma postagem com curtidas encontrada na última semana');
      return;
    }

    // Buscar o usuário que fez o post
    const autorUser = await client.users.fetch(autorMaisCurtido);
    const guild = canalAnuncio.guild;
    const newMember = await guild.members.fetch(autorMaisCurtido).catch(() => null);

    if (!newMember) {
      console.log('Usuário vencedor não encontrado no servidor');
      return;
    }

    // Gerenciar cargos de destaque
    try {
      // Remover cargo do usuário anterior (se houver)
      if (currentHighlightUserId && currentHighlightUserId !== autorMaisCurtido) {
        const previousMember = await guild.members.fetch(currentHighlightUserId).catch(() => null);
        if (previousMember && previousMember.roles.cache.has(cargoDestaqueId)) {
          await previousMember.roles.remove(cargoDestaqueId);
          console.log(`Cargo de destaque removido do usuário anterior: ${previousMember.user.username}`);
        }
      }

      // Adicionar cargo ao novo vencedor
      if (!newMember.roles.cache.has(cargoDestaqueId)) {
        await newMember.roles.add(cargoDestaqueId);
        console.log(`Cargo de destaque adicionado ao novo vencedor: ${autorUser.username}`);
      }

      // Atualizar o usuário atual com cargo
      currentHighlightUserId = autorMaisCurtido;

    } catch (cargoError) {
      console.error('Erro ao gerenciar cargos de destaque:', cargoError);
    }

    // Buscar a mensagem original do post para pegar o anexo
    try {
      const messages = await canal.messages.fetch({ limit: 100 });
      let anexoOriginal = null;

      // Procurar por mensagens do webhook que possam conter o anexo
      for (const message of messages.values()) {
        if (message.webhookId && message.createdTimestamp >= umaSemanaAtras.getTime()) {
          // Verificar se a mensagem tem anexos e corresponde ao período
          if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            anexoOriginal = attachment;
            break; // Usar o primeiro anexo encontrado como exemplo
          }
        }
      }

      // Criar embed do anúncio
      const anuncioEmbed = new EmbedBuilder()
        .setTitle('🏆 DESTAQUE DA SEMANA!')
        .setDescription(`
**🎉 Parabéns para ${autorUser}!**

Esta foi a postagem que mais recebeu curtidas na última semana:

**📊 Estatísticas:**
• **${maisCurtidas}** curtidas
• **Autor:** ${autorUser.username}
• **Data:** Esta semana
• **Cargo:** <@&${cargoDestaqueId}> adicionado até o próximo sábado

**🌟 Continue trazendo conteúdo incrível para nossa comunidade!**
`)
        .setColor('#FFD700')
        .setThumbnail(autorUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ 
          text: 'GIFZADA - Destaque da Semana', 
          iconURL: guild.iconURL({ dynamic: true, size: 64 })
        })
        .setTimestamp();

      // Se tiver anexo, adicionar à embed
      if (anexoOriginal) {
        anuncioEmbed.setImage(anexoOriginal.url);
      }

      // Enviar anúncio no canal específico
      await canalAnuncio.send({
        content: `🏆 **DESTAQUE DA SEMANA** 🏆\n${autorUser}`,
        embeds: [anuncioEmbed]
      });

      console.log(`Anúncio do destaque da semana enviado: ${maisCurtidas} curtidas de ${autorUser.username}`);

    } catch (error) {
      console.error('Erro ao buscar anexo original:', error);

      // Enviar anúncio sem anexo em caso de erro
      const anuncioEmbed = new EmbedBuilder()
        .setTitle('🏆 DESTAQUE DA SEMANA!')
        .setDescription(`
**🎉 Parabéns para ${autorUser}!**

Esta foi a postagem que mais recebeu curtidas na última semana:

**📊 Estatísticas:**
• **${maisCurtidas}** curtidas
• **Autor:** ${autorUser.username}
• **Data:** Esta semana
• **Cargo:** <@&${cargoDestaqueId}> adicionado até o próximo sábado

**🌟 Continue trazendo conteúdo incrível para nossa comunidade!**
`)
        .setColor('#FFD700')
        .setThumbnail(autorUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ 
          text: 'GIFZADA - Destaque da Semana', 
          iconURL: guild.iconURL({ dynamic: true, size: 64 })
        })
        .setTimestamp();

      await canalAnuncio.send({
        content: `🏆 **DESTAQUE DA SEMANA** 🏆\n${autorUser}`,
        embeds: [anuncioEmbed]
      });

      console.log(`Anúncio do destaque da semana enviado (sem anexo): ${maisCurtidas} curtidas de ${autorUser.username}`);
    }

  } catch (error) {
    console.error('Erro ao anunciar destaque da semana:', error);
  }
}

client.on('messageCreate', async message => {
  // Sistema de pontos automático multi-servidor
  if (!message.author.bot) {
    // Servidor Maker (1182331070750933073)
    if (message.guild.id === '1182331070750933073') {
      const pontosCanaisMaker = {
        '1329894823821312021': { tipo: 'entregas', pontos: 2 },
        '1329894869421920390': { tipo: 'vip', pontos: 4 },
        '1329894956503924839': { tipo: 'edicao', pontos: 3 },
        '1329894991937540116': { tipo: 'encontrar', pontos: 1 },
        '1269870523450527918': { tipo: 'recrutamento', pontos: 1 },
        '1392273829916704979': { tipo: 'verificacao', pontos: 1 }
      };

      const canalConfig = pontosCanaisMaker[message.channel.id];

      if (canalConfig) {
        try {
          await addMultiServerPoints(
            message.author.id,
            message.author.username,
            canalConfig.tipo,
            canalConfig.pontos,
            message.channel.id,
            message.id,
            `Mensagem no servidor maker - ${message.channel.name}`
          );

          console.log(`Pontos servidor maker: ${message.author.username} (+${canalConfig.pontos} por ${canalConfig.tipo})`);
        } catch (error) {
          console.error('Erro ao adicionar pontos servidor maker:', error);
        }
      }
    }

    // Sistema antigo para servidor principal (manter compatibilidade)
    if (message.guild.id === '953748240589787136' && message.member) {
      const pontosCanais = {
        '1218390839722639461': { tipo: 'suporte', pontos: 1 }
      };

      const canalConfig = pontosCanais[message.channel.id];

      if (canalConfig) {
        try {
          const isStaff = message.member.roles.cache.has('1094385139976507523');
          const isMaker = message.member.roles.cache.has('1065441764460199967');
          const isPostador = message.member.roles.cache.has('1072027317297229875');

          if (isStaff || isMaker || isPostador) {
            await addPoints(
              message.author.id,
              message.member.displayName || message.author.username,
              canalConfig.tipo,
              canalConfig.pontos,
              message.channel.id,
              message.id,
              `Mensagem enviada no canal ${message.channel.name}`
            );

            console.log(`Pontos adicionados: ${message.author.username} (+${canalConfig.pontos} por ${canalConfig.tipo})`);
          }
        } catch (error) {
          console.error('Erro ao adicionar pontos por mensagem:', error);
        }
      }
    }
  }

  // sistema de webhook para anexos do cargo específico
  if (message.channel.id === '1392228130361708645' && 
      message.member && 
      message.member.roles.cache.has('1392229571599929465') && 
      message.attachments.size > 0) {

    const attachment = message.attachments.first();
    const postId = `post_${Date.now()}_${message.author.id}`;

    try {
      // Criar post no database PostgreSQL
      await createPost(postId, message.author.id);
      console.log(`Novo post criado: ${postId} por ${message.author.username}`);
    } catch (error) {
      console.error('Erro ao criar post no database:', error);
      return;
    }

    // Criar webhook
    const webhooks = await message.channel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.name === 'Post System');

    if (!webhook) {
      webhook = await message.channel.createWebhook({
        name: 'Post System',
        avatar: message.guild.iconURL()
      });
    }

    // Criar botões - primeira linha (4 botões)
    const postButtons1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`like_${postId}`)
        .setLabel('0')
        .setEmoji('<:like:1392240788955598930>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`show_likes_${postId}`)
        .setEmoji('<:like_h:1392241390053883965>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comment_${postId}`)
        .setEmoji('<:comment:1392242013822521465>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`show_comments_${postId}`)
        .setEmoji('<:comments:1392242423186329693>')
        .setStyle(ButtonStyle.Secondary)
    );

    // Segunda linha (1 botão)
    const postButtons2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`settings_${postId}`)
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      // Baixar e reenviar o arquivo para garantir permanência
      const response = await fetch(attachment.url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileAttachment = new AttachmentBuilder(buffer, { name: attachment.name });

      // Enviar via webhook e aguardar a resposta
      const webhookMessage = await webhook.send({
        content: ` Post de ${message.author}`,
        files: [fileAttachment],
        username: message.author.displayName || message.author.username,
        avatarURL: message.author.displayAvatarURL({ dynamic: true }),
        components: [postButtons1, postButtons2],
        wait: true // Importante: aguardar a resposta para obter o ID da mensagem
      });

      console.log(`Post criado: ${postId} por ${message.author.username} - Mensagem: ${webhookMessage.id}`);

      // Atualizar o post no banco com o ID da mensagem
      try {
        await pgClient.query(
          'UPDATE instagram_posts SET message_id = $1 WHERE post_id = $2',
          [webhookMessage.id, postId]
        );
        console.log(`Post ${postId} atualizado com message_id: ${webhookMessage.id}`);
      } catch (updateError) {
        console.error('Erro ao atualizar message_id do post:', updateError);
      }

      // Deletar mensagem original
      await message.delete();
    } catch (error) {
      console.error('Erro ao criar post:', error);
      // Se houver erro, deletar o post do database
      try {
        await deletePost(postId);
      } catch (dbError) {
        console.error('Erro ao deletar post do database:', dbError);
      }
    }
    return;
  }

  // Sistema !sejamaker (apenas staff)
  if (message.content === '!sejamaker') {
    // Verificar se o usuário tem o cargo de staff
    const staffRoleId = '1094385139976507523';
    const hasStaffRole = message.member.roles.cache.has(staffRoleId);

    if (!hasStaffRole) {
      return message.reply({
        content: '❌ Apenas membros da staff podem usar este comando.',
       flags: 1 << 6
      });
    }

    const recruitmentEmbed = new EmbedBuilder()
      .setTitle('<:d_tag:1366581862004166656>┊GIFZADA - RECRUTAMENTO')
      .setDescription(`
<:1269199842866106458:1269199842866106458>

<:1269198470309220385:1269198470309220385> Seja parte da STAFF!

<:1266748851050774540:1266748851050774540> | **Por que ser STAFF?**
Você gosta de criar, editar e movimentar a comunidade? Então esse espaço é seu!
Nossa equipe é formada por pessoas talentosas que mantêm o servidor vivo com conteúdos como GIFs, ícones, emojis e edições únicas.

<:1266748851050774540:1266748851050774540> | **O que esperamos de você?**
• Comprometimento com a entrega de conteúdo criativo.
• Participação ativa na comunidade.
• Interesse em crescer dentro da equipe e em outras áreas — todos começam de base, mas podem subir de cargo!

<:1266748851050774540:1266748851050774540> | **Já tem experiência?**
<:1269198470309220385:1269198470309220385> Se você já foi staff em outros servidores de GIFs ou Comunidade, pode solicitar uma migração de cargo!
Basta preencher o formulário na aba de migração e responder às perguntas com atenção.
`)
      .setColor('#9c41ff')
      .setImage('https://media.discordapp.net/attachments/1381309996393959619/1399226611127029801/image.png?ex=68883ad4&is=6886e954&hm=7c8718351016bab3ab3f6bbd66388be0c0ed9dafd065142b8a3b2eb28ec69c45&=&format=webp&quality=lossless')
      .setThumbnail(message.guild.iconURL({ dynamic: true, size: 512 }));

    const recruitmentRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('f68019bd98e443d9bfbefbb1bb752d44')
        .setLabel('Seja Staff')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('d2930ffe9dc94bf1bdd2d1f85db7299d')
        .setLabel('Migração')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [recruitmentEmbed], components: [recruitmentRow] });
  }

  if (message.content === '!suporte') {
    const embed = new EmbedBuilder()
      .setTitle('<:d_emoji_278:1366581300500365343> ┊GIFZADA - SUPORTE')
      .setDescription(`

> <:d_membro:1366581862004166656> | **Está tendo algum problema no servidor? Contate-nos! Utilize o suporte para tirar dúvidas ou denunciar membros.**

<:d_dot43:1366581992413728830> **AJUDA:**
1. Esclareça dúvidas sobre o servidor.
2. Relate problemas gerais do servidor.
3. Converse com nossa equipe para questões sobre pedidos e fale com nossos makers.

<:d_dot43:1366581992413728830> **DENÚNCIAS:**
1. Denuncie membros que violaram nossas regras!
2. Divulgação inadequada via DM.
3. Problemas com nossos staffs
`)
      .setColor('#9c41ff')
      .setThumbnail(message.guild.iconURL({ dynamic: true, size: 512 }))
      .setImage('https://cdn.discordapp.com/attachments/1269195059253870634/1279897590531620977/316_Sem_Titulo_20240805003410.png?ex=685bb044&is=685a5ec4&hm=2792dcadd8898a0a56fecb4b9fdad749500f1cd5c32c8b515f05387902c2cd30&');

    const suporteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('receba_ajuda')
        .setLabel('Receba Ajuda')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('denunciar_alguem')
        .setLabel('Denunciar Alguém')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [suporteRow] });
  }

  if (message.content === '!converter') {
    const embed = new EmbedBuilder()
      .setTitle('<:a_gifzada:1266774740115132468> **GIFZADA CONVERSOR**')
      .setDescription(`
> <:d_dot43:1366581992413728830> *Agora você pode transformar vídeos e imagens de maneira rápida, fácil e totalmente automática, sem sair do Gifzada. Confira abaixo como funciona e aproveite todas as opções disponíveis:*

<:d_emoji_273:1366581300500365343> *Transforme seus arquivos com qualidade profissional e velocidade incomparável! Nosso sistema utiliza tecnologia de ponta para entregar resultados perfeitos.*

## <:d_emoji_273:1366581300500365343> **Como utilizar o conversor:**
\`\`\`yaml
1️⃣ Prepare seu arquivo (vídeo/imagem)
2️⃣ Clique em "Iniciar Conversão"
3️⃣ Ambiente privado será criado
4️⃣ Escolha o tipo de conversão
5️⃣ Envie o arquivo e aguarde
6️⃣ Receba o resultado otimizado!
\`\`\`

## <:d_emoji_274:1366581475310309376> **Opções de conversão disponíveis:**

### <:d_arrow:1366582051507273728> **Vídeo → GIF**
\`•\` Conversão inteligente com otimização automática
\`•\` Suporte: MP4, AVI, MOV, WMV, MKV, WEBM
\`•\` FPS adaptativo e compressão avançada

### <:d_arrow:1366582051507273728> **Redimensionar GIF**
\`•\` Algoritmo de redimensionamento inteligente
\`•\` Preservação da qualidade visual
\`•\` Otimização para redes sociais

### <:d_arrow:1366582051507273728> **Cortar Imagem/GIF**
\`•\` Crop com proporção 1:1
\`•\` Detecção automática da melhor área
\`•\` Suporte a todos os formatos de imagem

### <:d_arrow:1366582051507273728> **YouTube → GIF**
\`•\` Download direto de vídeos do YouTube
\`•\` Conversão automática para GIF
\`•\` Qualidade HD preservada

## <:d_tag:1366581862004166656> **ESTATÍSTICAS EM TEMPO REAL:**
\`•\`  Velocidade: **3x mais rápido**
\`•\`  Precisão: **99.9% de sucesso**
\`•\`  Economia: **Até 80% menor**
\`•\`  Formatos: **15+ suportados**
`)
      .setThumbnail('https://cdn.discordapp.com/icons/953748240589787136/a_85b194eaf3055cfc583d70b3b14cbaa5.gif?size=2048')
      .setColor('#870cff')
      .setFooter({ 
        text: 'CONVERSOR GIFZADA', 
        iconURL: 'https://cdn.discordapp.com/icons/953748240589787136/a_85b194eaf3055cfc583d70b3b14cbaa5.gif?size=64'
      })
      .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('abrir_conversor')
        .setLabel('Iniciar Conversão')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('suporte')
        .setLabel('Suporte')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row1] });
  }

  // Comando !privatethread
  if (message.content.startsWith('!privatethread ')) {
    const staffRoleId = '1230677503719374990';
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasStaffRole = message.member.roles.cache.has(staffRoleId);
    const hasAdminRole = message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasStaffRole && !hasAdminRole) {
      return message.reply({
        content: '❌ Apenas staffs ou administradores podem usar este comando.',
        flags: 1 << 6
      });
    }

    const channelId = message.content.split(' ')[1];

    if (!channelId) {
      return message.reply({
        content: '❌ Por favor, forneça o ID do canal.\n**Uso:** `!privatethread [ID_DO_CANAL]`',
        flags: 1 << 6
      });
    }

    const targetChannel = client.channels.cache.get(channelId);

    if (!targetChannel) {
      return message.reply({
        content: '❌ Canal não encontrado. Verifique se o ID está correto.',
        flags: 1 << 6
      });
    }

    // Embed de carregamento
    const loadingEmbed = new EmbedBuilder()
      .setTitle('🔒 **PRIVATIZANDO THREADS**')
      .setDescription(`
**Canal:** ${targetChannel}
**Status:** Carregando threads...

> ⏳ *Aguarde enquanto analisamos e privatizamos todas as threads do canal...*
`)
      .setColor('#ffaa00')
      .setTimestamp();

    const loadingMessage = await message.reply({ embeds: [loadingEmbed] });

    try {
      // Buscar todas as threads do canal (ativas e arquivadas)
      const activeThreads = await targetChannel.threads.fetchActive();
      const archivedThreads = await targetChannel.threads.fetchArchived();

      // Combinar threads ativas e arquivadas
      const allThreads = new Map([...activeThreads.threads, ...archivedThreads.threads]);

      let threadsProcessadas = 0;
      let threadsPrivatizadas = 0;
      let threadsErros = 0;
      let threadsJaPrivadas = 0;
      const threadsDetails = [];

      for (const [threadId, thread] of allThreads) {
        threadsProcessadas++;

        try {
          // Verificar se a thread já é privada
          if (thread.type === 12) { // GUILD_PRIVATE_THREAD
            threadsJaPrivadas++;
            threadsDetails.push({
              name: thread.name,
              id: threadId,
              status: 'Já privada'
            });
            continue;
          }

          // Tentar privatizar a thread (só funciona se ela for pública)
          if (thread.type === 11) { // GUILD_PUBLIC_THREAD
            // Infelizmente, não é possível converter threads públicas para privadas via API do Discord
            // Threads são definidas como públicas ou privadas no momento da criação
            threadsDetails.push({
              name: thread.name,
              id: threadId,
              status: 'Impossível privatizar (já é pública)'
            });
          } else {
            threadsDetails.push({
              name: thread.name,
              id: threadId,
              status: 'Tipo desconhecido'
            });
          }

        } catch (error) {
          console.error(`Erro ao processar thread ${threadId}:`, error);
          threadsErros++;
          threadsDetails.push({
            name: thread.name || 'Thread desconhecida',
            id: threadId,
            status: 'Erro ao processar'
          });
        }
      }

      // Criar relatório detalhado
      let detailsText = '';
      if (threadsDetails.length > 0) {
        const sortedDetails = threadsDetails.slice(0, 15);
        detailsText = sortedDetails.map(thread => 
          `**${thread.name}** - *${thread.status}*`
        ).join('\n');

        if (threadsDetails.length > 15) {
          detailsText += `\n*... e mais ${threadsDetails.length - 15} thread(s)*`;
        }
      } else {
        detailsText = '*Nenhuma thread encontrada*';
      }

      // Embed final com resultados
      const resultEmbed = new EmbedBuilder()
        .setTitle('🔒 **ANÁLISE DE THREADS CONCLUÍDA**')
        .setDescription(`
**Canal analisado:** ${targetChannel}
**Executado por:** ${message.author}

## 📊 **ESTATÍSTICAS:**

\`\`\`yaml
 Threads Analisadas: ${threadsProcessadas}
 Já Privadas: ${threadsJaPrivadas}
 Impossível Privatizar: ${threadsProcessadas - threadsJaPrivadas - threadsErros}
 Erros: ${threadsErros}
\`\`\`

## 📋 **DETALHES DAS THREADS:**

${detailsText}

## ⚠️ **IMPORTANTE:**
> **Limitação da API do Discord:** Não é possível converter threads públicas existentes para privadas. As threads são definidas como públicas ou privadas no momento da criação e não podem ser alteradas posteriormente.

> **Solução:** Para ter threads privadas, elas precisam ser criadas como privadas desde o início usando o parâmetro \`type: 12\` na criação.
`)
        .setColor('#ff6b6b')
        .addFields(
          { 
            name: '🔒 **Threads Já Privadas**', 
            value: `${threadsJaPrivadas} thread(s)`, 
            inline: true 
          },
          { 
            name: '🔓 **Threads Públicas**', 
            value: `${threadsProcessadas - threadsJaPrivadas - threadsErros} thread(s)`, 
            inline: true 
          },
          { 
            name: '❌ **Erros**', 
            value: `${threadsErros} thread(s)`, 
            inline: true 
          }
        )
        .setFooter({ 
          text: 'GIFZADA • Sistema de Análise de Threads',
          iconURL: message.guild.iconURL({ dynamic: true, size: 64 })
        })
        .setTimestamp();

      await loadingMessage.edit({ embeds: [resultEmbed] });

    } catch (error) {
      console.error('Erro ao processar comando privatethread:', error);

      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ **ERRO NO PROCESSAMENTO**')
        .setDescription(`
**Erro ao analisar threads do canal**

\`\`\`
${error.message}
\`\`\`

> ⚠️ *Verifique se o bot tem as permissões necessárias no canal*
`)
        .setColor('#ff4444')
        .setTimestamp();

      await loadingMessage.edit({ embeds: [errorEmbed] });
    }
    return;
  }

  // Comando !fecharconversor
  if (message.content.startsWith('!fecharconversor ')) {
    const staffRoleId = '1230677503719374990';
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasStaffRole = message.member.roles.cache.has(staffRoleId);
    const hasAdminRole = message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasStaffRole && !hasAdminRole) {
      return message.reply({
        content: '❌ Apenas staffs ou administradores podem usar este comando.',
       flags: 1 << 6
      });
    }

    const channelId = message.content.split(' ')[1];

    if (!channelId) {
      return message.reply({
        content: '❌ Por favor, forneça o ID do canal.\n**Uso:** `!fecharconversor [ID_DO_CANAL]`',
       flags: 1 << 6
      });
    }

    const targetChannel = client.channels.cache.get(channelId);

    if (!targetChannel) {
      return message.reply({
        content: '❌ Canal não encontrado. Verifique se o ID está correto.',
       flags: 1 << 6
      });
    }

    // Embed de carregamento
    const loadingEmbed = new EmbedBuilder()
      .setTitle('🔄 **ANALISANDO THREADS DO CONVERSOR**')
      .setDescription(`
**Canal:** ${targetChannel}
**Status:** Carregando threads...

> ⏳ *Aguarde enquanto analisamos todas as threads do canal...*
`)
      .setColor('#ffaa00')
      .setTimestamp();

    const loadingMessage = await message.reply({ embeds: [loadingEmbed] });

    try {
      // Buscar todas as threads do canal
      const threads = await targetChannel.threads.fetchActive();
      const archivedThreads = await targetChannel.threads.fetchArchived();

      // Combinar threads ativas e arquivadas
      const allThreads = new Map([...threads.threads, ...archivedThreads.threads]);

      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000); // 1 dia em milliseconds
      let threadsAbertas = 0;
      let threadsFechadas = 0;
      let threadsProcessadas = 0;
      const threadsDetails = [];

      for (const [threadId, thread] of allThreads) {
        threadsProcessadas++;

        // Verificar se a thread é de conversão (tem nome relacionado a conversão)
        const isConversionThread = thread.name.includes('Conversão') || 
                                   thread.name.includes('🎞️') || 
                                   conversaoEscolha.has(threadId);

        if (isConversionThread) {
          const threadAge = Date.now() - thread.createdTimestamp;
          const isOld = threadAge > (24 * 60 * 60 * 1000); // Mais de 1 dia

          if (isOld && !thread.archived && !thread.locked) {
            try {
              // Enviar mensagem de fechamento pela administração
              await thread.send('🔒 **Fechado pela administração do servidor**');

              // Aguardar 2 segundos antes de fechar e trancar
              await new Promise(resolve => setTimeout(resolve, 2000));

              // Fechar e arquivar a thread
              await thread.setLocked(true);
              await thread.setArchived(true);

              // Limpar dados da thread
              clearInactivityTimer(threadId);
              conversaoEscolha.delete(threadId);

              threadsFechadas++;
              threadsDetails.push({
                name: thread.name,
                id: threadId,
                age: Math.floor(threadAge / (24 * 60 * 60 * 1000)),
                status: 'Fechada'
              });
            } catch (error) {
              console.error(`Erro ao fechar thread ${threadId}:`, error);
              threadsDetails.push({
                name: thread.name,
                id: threadId,
                age: Math.floor(threadAge / (24 * 60 * 60 * 1000)),
                status: 'Erro ao fechar'
              });
            }
          } else if (!thread.archived) {
            threadsAbertas++;
            threadsDetails.push({
              name: thread.name,
              id: threadId,
              age: Math.floor(threadAge / (24 * 60 * 60 * 1000)),
              status: thread.archived ? 'Arquivada' : 'Aberta'
            });
          }
        }
      }

      // Criar relatório detalhado
      let detailsText = '';
      if (threadsDetails.length > 0) {
        const sortedDetails = threadsDetails.sort((a, b) => b.age - a.age);
        detailsText = sortedDetails.slice(0, 10).map(thread => 
          `**${thread.name}** (${thread.age}d) - *${thread.status}*`
        ).join('\n');

        if (sortedDetails.length > 10) {
          detailsText += `\n*... e mais ${sortedDetails.length - 10} thread(s)*`;
        }
      } else {
        detailsText = '*Nenhuma thread de conversão encontrada*';
      }

      // Embed final com resultados
      const resultEmbed = new EmbedBuilder()
        .setTitle('🔒 **LIMPEZA DE THREADS CONCLUÍDA**')
        .setDescription(`
**Canal analisado:** ${targetChannel}
**Executado por:** ${message.author}

## 📊 **ESTATÍSTICAS:**

\`\`\`yaml
 Threads Totais Analisadas: ${threadsProcessadas}
 Threads de Conversão: ${threadsDetails.length}
 Threads Abertas: ${threadsAbertas}
 Threads Fechadas: ${threadsFechadas}
 Critério: Mais de 1 dia de existência
\`\`\`

## 📋 **DETALHES DAS THREADS:**

${detailsText}

> 🔄 *Threads antigas foram automaticamente fechadas para otimizar o servidor*
`)
        .setColor(threadsFechadas > 0 ? '#00ff88' : '#4169e1')
        .addFields(
          { 
            name: '✅ **Threads Mantidas Abertas**', 
            value: `${threadsAbertas} thread(s)`, 
            inline: true 
          },
          { 
            name: '🔒 **Threads Fechadas**', 
            value: `${threadsFechadas} thread(s)`, 
            inline: true 
          },
          { 
            name: '📊 **Total Processadas**', 
            value: `${threadsProcessadas} thread(s)`, 
            inline: true 
          }
        )
        .setFooter({ 
          text: 'GIFZADA CONVERSOR • Sistema de Limpeza Automática',
          iconURL: message.guild.iconURL({ dynamic: true, size: 64 })
        })
        .setTimestamp();

      await loadingMessage.edit({ embeds: [resultEmbed] });

    } catch (error) {
      console.error('Erro ao processar comando fecharconversor:', error);

      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ **ERRO NO PROCESSAMENTO**')
        .setDescription(`
**Erro ao analisar threads do canal**

\`\`\`
${error.message}
\`\`\`

> ⚠️ *Verifique se o bot tem as permissões necessárias no canal*
`)
        .setColor('#ff4444')
        .setTimestamp();

      await loadingMessage.edit({ embeds: [errorEmbed] });
    }
    return;
  }

  if (message.content === '!setnotify') {
    const notifyEmbed = new EmbedBuilder()
      .setTitle('<:d_emoji_274:1269197941751545947>┊GIFZADA - NOTIFICAÇÕES')
      .setDescription(`
<:1266748851050774540:1266748851050774540> Receba nossos cargos de notificações para evitar menções em excesso. Logo abaixo estão os tipos de notificações disponíveis.

<:1270121894946799626:1270121894946799626> | Notificações Gerais:
<:1269198470309220385:1269198470309220385> Esteja informado sobre nossas mudanças no servidor e possíveis sorteios.

<:1270121894946799626:1270121894946799626> | Notificações de Pedidos:
<:1269198470309220385:1269198470309220385> Saiba quando abrirem nossos pedidos; mencionaremos sempre que os chats estiverem disponíveis.

<:emoji_272:1398746634602549248> | Notificações Gerais.
<:emoji_272:1398746634602549248> | Notificações: Pedidos-Gif.
<:emoji_272:1398746634602549248> | Notificações: Pedidos-Icon.
`)
      .setColor('#9c41ff')
      .setThumbnail(message.guild.iconURL({ dynamic: true, size: 512 }))
      .setImage('attachment://banner.png')
      .setTimestamp();

    const notifyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('notify_geral')
        .setEmoji('<:emoji_272:1398746634602549248>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('notify_pedidos_gif')
        .setEmoji('<:emoji_272:1398746634602549248>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('notify_pedidos_icon')
        .setEmoji('<:emoji_272:1398746634602549248>')
        .setStyle(ButtonStyle.Secondary)
    );

    const bannerAttachment = new AttachmentBuilder('./banner.png', { name: 'banner.png' });

    await message.channel.send({ 
      embeds: [notifyEmbed], 
      components: [notifyRow],
      files: [bannerAttachment]
    });
  }

  if (message.content === '!setnickcolor') {
    const nickColorEmbed = new EmbedBuilder()
      .setTitle('<:d_emoji_274:1269197941751545947> ┊GIFZADA - NICK COLOR')
      .setDescription(`
<:1269198470309220385:1269198470309220385> Cansou da cor do seu apelido no servidor? Deixe seu perfil em nosso servidor mais colorido seguindo as instruções abaixo!

<:d_brush:1398752562072522843> | Para receber a cor <@&1065441794684362752>
<:y_brush:1398752431902298152> | Para receber a cor <@&1065441793304449074>
<:o_brush:1398752246338027530> | Para receber a cor <@&1065441795783282898>
<:e_brush:1398751907853631539> | Para receber a cor <@&1065441790972399646>
<:f_brush:1398752104285343918> | Para receber a cor <@&1236336928807321663> 

1. Clique no botão correspondente à cor desejada;
2. Após isso, seu apelido já terá a cor selecionada.
3. Caso queira retirar o cargo de cor, basta clicar no botão novamente.
`)
      .setColor('#9c41ff')
      .setThumbnail(message.guild.iconURL({ dynamic: true, size: 512 }))
      .setImage('attachment://nickcolor.png')
      .setTimestamp();

    const nickColorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('nickcolor_d')
        .setEmoji('<:d_brush:1398752562072522843>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('nickcolor_y')
        .setEmoji('<:y_brush:1398752431902298152>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('nickcolor_o')
        .setEmoji('<:o_brush:1398752246338027530>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('nickcolor_e')
        .setEmoji('<:e_brush:1398751907853631539>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('nickcolor_f')
        .setEmoji('<:f_brush:1398752104285343918>')
        .setStyle(ButtonStyle.Secondary)
    );

    const nickColorAttachment = new AttachmentBuilder('./nickcolor.png', { name: 'nickcolor.png' });

    await message.channel.send({ 
      embeds: [nickColorEmbed], 
      components: [nickColorRow],
      files: [nickColorAttachment]
    });
  }

  if (message.content === '!setnickboostercolor') {
    const nickBoosterColorEmbed = new EmbedBuilder()
      .setTitle('<:d_emoji_274:1269197941751545947> ┊GIFZADA - NICK COLOR BOOSTER')
      .setDescription(`
<:1269198470309220385:1269198470309220385> Cansou da cor do seu apelido no servidor? Deixe seu perfil em nosso servidor mais colorido seguindo as instruções abaixo!

**CORES BOOSTER DISPONÍVEIS:**

 **PASTÉIS**
<:p_brush:1398758670761988157> - <@&1298119975453593600>
<:p_brush1:1398758933182550067> - <@&1298119805936734248>
<:p_brush2:1398759046445535393> - <@&1298120196908912660>
<:p_brush3:1398759435345858561> - <@&1298120108719345674>
<:p_brush4:1398759757027999744> - <@&1298120431605121024>

 **NEON**
<:n_brush:1398759884815863950> - <@&1398736295278153901>
<:n_brush1:1398759976343961712> - <@&1398736303926804530>
<:n_brush2:1398760077686472815> - <@&1398736311032090706>

 **METÁLICAS**
<:m_brush:1398760429248970753> - <@&1398736652163219557>
<:m_brush1:1398760537738969198> - <@&1398736647537033318>
<:m_brush2:1398760653413679167> - <@&1398736657041068042>

1. Selecione a categoria de cor desejada no menu abaixo;
2. Escolha a cor específica que deseja;
3. Após isso, seu apelido já terá a cor selecionada.
`)
      .setColor('#9c41ff')
      .setThumbnail(message.guild.iconURL({ dynamic: true, size: 512 }))
      .setImage('attachment://nickcolor.png')
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('booster_color_category')
      .setPlaceholder(' Escolha uma categoria de cor')
      .addOptions([
        {
          label: 'Pastéis',
          description: 'Cores pastéis suaves e delicadas',
          value: 'pasteis',
        },
        {
          label: 'Neon',
          description: 'Cores neon vibrantes e chamativas',
          value: 'neon',
        },
        {
          label: 'Metálicas',
          description: 'Cores metálicas elegantes',
          value: 'metalicas',
        }
      ]);

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);
    const nickColorAttachment = new AttachmentBuilder('./nickcolor.png', { name: 'nickcolor.png' });

    await message.channel.send({ 
      embeds: [nickBoosterColorEmbed], 
      components: [selectRow],
      files: [nickColorAttachment]
    });
  }

  if (message.content === '!painel') {
    // Verificar se o usuário tem o cargo de staff
    const staffRoleId = '1230677503719374990';
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907',];
    const hasStaffRole = message.member.roles.cache.has(staffRoleId);
    const hasAdminRole = message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasStaffRole && !hasAdminRole) {
      return message.reply({
        content: '❌ Apenas staffs ou administradores podem usar este comando.',
       flags: 1 << 6
      });
    }

    // Estatísticas do sistema
    const activeThreadsCount = activeVerificationThreads.size;
    const blockedUsersCount = blockedVerificationUsers.size;
    const totalPosts = postAuthors.size;
    const totalLikes = Array.from(postLikes.values()).reduce((total, likes) => total + likes.size, 0);
    const totalComments = Array.from(postComments.values()).reduce((total, comments) => total + comments.length, 0);

    // Buscar estatísticas de feedback
    let totalFeedbacks = 0;
    try {
      const feedbackResult = await pgClient.query('SELECT COUNT(*) as count FROM staff_feedback');
      totalFeedbacks = parseInt(feedbackResult.rows[0].count);
    } catch (error) {
      console.error('Erro ao buscar total de feedbacks:', error);
    }

    const painelEmbed = new EmbedBuilder()
      .setTitle(' PAINEL ADMINISTRATIVO')
      .setDescription(`
**Painel de controle para administradores**

##  **ESTATÍSTICAS DO SISTEMA:**
\`\`\`yaml
 Verificações Ativas: ${activeThreadsCount}
 Usuários Bloqueados: ${blockedUsersCount}
 Total de Posts: ${totalPosts}
 Total de Curtidas: ${totalLikes}
 Total de Comentários: ${totalComments}
 Total de Feedbacks: ${totalFeedbacks}
\`\`\`

##  **ÁREAS DISPONÍVEIS:**

Selecione uma área para acessar suas funções específicas:

 **INSTAGRAM** - Gestão de posts e verificação
 **RECRUTAMENTO** - Sistema de blacklist e recrutamento
 **DESEMPENHO STAFF** - Estatísticas de feedback da equipe
 **ADMINISTRAÇÃO** - Gerenciamento de cargos (apenas admins)
`)
      .setColor('#9c41ff')
      .setTimestamp();

    const mainButtons1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('painel_instagram')
        .setLabel('Instagram')
        .setEmoji('📱')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('painel_recrutamento')
        .setLabel('Recrutamento')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('painel_desempenho')
        .setLabel('Desempenho Staff')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Success)
    );

    const mainButtons2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('painel_administracao')
        .setLabel('Administração')
        .setEmoji('⚖️')
        .setStyle(ButtonStyle.Danger)
    );

    await message.channel.send({ embeds: [painelEmbed], components: [mainButtons1, mainButtons2] });
  }

  // Comandos administrativos de pontos
  if (message.content.startsWith('!addpontos')) {
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasAdminRole = message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasAdminRole) {
      return message.reply('❌ Apenas administradores podem adicionar pontos.');
    }

    const args = message.content.split(' ');
    if (args.length < 4) {
      return message.reply('❌ Uso: `!addpontos @usuário <tipo> <pontos> [descrição]`\nTipos: entregas, vip, edicao, encontrar, recrutamento, verificacao, suporte');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('❌ Mencione um usuário válido.');
    }

    const activityType = args[2].toLowerCase();
    const points = parseInt(args[3]);
    const description = args.slice(4).join(' ') || `Pontos adicionados manualmente por ${message.author.username}`;

    const validTypes = ['entregas', 'vip', 'edicao', 'encontrar', 'recrutamento', 'verificacao', 'suporte'];
    if (!validTypes.includes(activityType)) {
      return message.reply('❌ Tipo inválido. Use: entregas, vip, edicao, encontrar, recrutamento, verificacao, suporte');
    }

    if (isNaN(points) || points <= 0) {
      return message.reply('❌ Quantidade de pontos deve ser um número positivo.');
    }

    try {
      await addPoints(targetUser.id, targetUser.displayName || targetUser.username, activityType, points, message.channel.id, message.id, description);

      await message.reply(`✅ **${points} pontos** adicionados para ${targetUser} na categoria **${activityType}**!`);
    } catch (error) {
      console.error('Erro ao adicionar pontos:', error);
      await message.reply('❌ Erro ao adicionar pontos. Tente novamente.');
    }
  }

  if (message.content.startsWith('!resetpontos')) {
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasAdminRole = message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasAdminRole) {
      return message.reply('❌ Apenas administradores podem resetar pontos.');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('❌ Mencione um usuário válido para resetar os pontos.');
    }

    try {
      await resetUserPoints(targetUser.id);
      await message.reply(`✅ Pontos de ${targetUser} foram resetados com sucesso!`);
    } catch (error) {
      console.error('Erro ao resetar pontos:', error);
      await message.reply('❌ Erro ao resetar pontos. Tente novamente.');
    }
  }

  if (message.content === '!verificar') {
    const verificationEmbed = new EmbedBuilder()
      .setTitle('**Verificação**')
      .setDescription(`
> Manter o ambiente seguro e verdadeiro é essencial para todos.

<:d_arrow:1366582051507273728>  **Por que verificar?**
> A autenticação comprova que você é realmente quem diz ser. Isso ajuda a manter a confiança entre os membros e libera o acesso aos canais de mídia.

**Etapas do processo:**
<:d_dot43:1366581992413728830>  Mostre seu rosto em tempo real a um dos admins listados;
<:d_dot43:1366581992413728830> Suas informações não serão compartilhadas com ninguém além da equipe responsável.

**Equipe principal de verificação:**
<@1057450058347462838> • <@309686166460956672> • <@1032510101753446421> • <@1217811542012198926>

<:d_dot43:1366581992413728830>  Este espaço é reservado apenas para imagens reais do seu próprio rosto.
<:d_dot43:1366581992413728830>  Evite usar fotos de outras pessoas ou qualquer conteúdo enganoso.
<:d_dot43:1366581992413728830>  Quebrar essas regras pode resultar na perda da verificação.
`)
      .setColor('#9c41ff')
      .setTimestamp();

    const verificationRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verificar_se')
        .setLabel('Verificar-se')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [verificationEmbed], components: [verificationRow] });
  }

  // Comando !pontos (novo sistema multi-servidor)
  if (message.content === '!pontos') {
    const userId = message.author.id;

    try {
      // Buscar dados do usuário no servidor principal
      const mainGuild = client.guilds.cache.get('953748240589787136');
      const makerGuild = client.guilds.cache.get('1182331070750933073');

      if (!mainGuild) {
        return message.reply('❌ Servidor principal não encontrado.');
      }

      const mainMember = await mainGuild.members.fetch(userId).catch(() => null);

      if (!mainMember) {
        return message.reply('❌ Você não está no servidor principal.');
      }

      // Verificar cargos no servidor principal
      const hasMakerRole = mainMember.roles.cache.has('1224755216038236232');
      const hasRecruitmentRole = mainMember.roles.cache.has('1230677503719374990');
      const hasVerificationRole = mainMember.roles.cache.has('1392247839857315912');
      const hasSupportRole = mainMember.roles.cache.has('1165308513355046973');

      // Buscar pontos do usuário
      const userPoints = await getUserPoints(userId);

      if (!userPoints) {
        await createOrUpdateUserPoints(userId, mainMember.displayName || mainMember.user.username);
        const newUserEmbed = new EmbedBuilder()
          .setTitle('📊 ESTATÍSTICAS DE PONTOS')
          .setDescription(`
**Usuário:** ${mainMember.displayName || mainMember.user.username}
**ID:** ${userId}

**Função:** Usuário registrado
**Pontos Totais:** 0

*Usuário registrado no sistema de pontos!*
`)
          .setColor('#9c41ff')
          .setThumbnail(mainMember.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        return message.reply({ embeds: [newUserEmbed] });
      }

      // Determinar função do usuário
      let userFunction = 'Membro';
      let statsEmbed;

      if (hasMakerRole) {
        // Embed para Makers
        const entregasPontos = userPoints.entregas_count * 2;
        const vipPontos = userPoints.vip_count * 4;
        const edicaoPontos = userPoints.edicao_count * 3;
        const encontrarPontos = userPoints.encontrar_count * 1;
        const totalEntregas = userPoints.entregas_count + userPoints.vip_count + userPoints.edicao_count + userPoints.encontrar_count;

        statsEmbed = new EmbedBuilder()
          .setTitle('📊 ESTATÍSTICAS DE PONTOS')
          .setDescription(`
**Nickname:** ${userPoints.username}
**ID:** ${userId}

**Função:** GIF Maker

**📈 ENTREGAS REALIZADAS:**
• **Entregas:** ${userPoints.entregas_count} (${entregasPontos} pontos)
• **VIP:** ${userPoints.vip_count} (${vipPontos} pontos)  
• **Edição:** ${userPoints.edicao_count} (${edicaoPontos} pontos)
• **Encontrar:** ${userPoints.encontrar_count} (${encontrarPontos} pontos)

**RESUMO:**
• **Total de Entregas:** ${totalEntregas}
• **Total de Pontos:** ${userPoints.total_points}

**Última atualização:** ${new Date(userPoints.last_updated).toLocaleDateString('pt-BR')}
`)
          .setColor('#00ff88')
          .setThumbnail(mainMember.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Sistema de Pontos GIFZADA' })
          .setTimestamp();

      } else if (hasRecruitmentRole) {
        // Embed para Recrutamento
        let recruitmentStats = `
**Nickname:** ${userPoints.username}
**ID:** ${userId}

**Função:** Recrutamento

**ATIVIDADES REALIZADAS:**
• **Recrutamentos:** ${userPoints.recrutamento_count}`;

        if (hasVerificationRole) {
          recruitmentStats += `\n• **Verificação:** ${userPoints.verificacao_count}`;
        }

        if (hasSupportRole) {
          recruitmentStats += `\n• **Suportes:** ${userPoints.suporte_count}`;
        }

        recruitmentStats += `\n\n** RESUMO:**
• **Total de Pontos:** ${userPoints.total_points}

**Última atualização:** ${new Date(userPoints.last_updated).toLocaleDateString('pt-BR')}`;

        statsEmbed = new EmbedBuilder()
          .setTitle('ESTATÍSTICAS DE PONTOS')
          .setDescription(recruitmentStats)
          .setColor('#7289DA')
          .setThumbnail(mainMember.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Sistema de Pontos GIFZADA' })
          .setTimestamp();

      } else {
        // Embed padrão para outros usuários
        statsEmbed = new EmbedBuilder()
          .setTitle('ESTATÍSTICAS DE PONTOS')
          .setDescription(`
**Nickname:** ${userPoints.username}
**ID:** ${userId}

**Função:** Membro

**RESUMO:**
• **Total de Pontos:** ${userPoints.total_points}

**Última atualização:** ${new Date(userPoints.last_updated).toLocaleDateString('pt-BR')}
`)
          .setColor('#9c41ff')
          .setThumbnail(mainMember.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Sistema de Pontos GIFZADA' })
          .setTimestamp();
      }

      await message.reply({ embeds: [statsEmbed] });

    } catch (error) {
      console.error('Erro no comando !pontos:', error);
      await message.reply('❌ Erro ao buscar as estatísticas. Tente novamente.');
    }
    return;
  }

  // Comando !resetpontos (apenas administradores)
  if (message.content === '!resetpontos') {
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasAdminRole = message.member && message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasAdminRole) {
      return message.reply('❌ Apenas administradores podem usar este comando.');
    }

    try {
      // Buscar total de usuários antes do reset
      const totalUsersResult = await pgClient.query('SELECT COUNT(*) as count FROM user_points');
      const totalUsers = parseInt(totalUsersResult.rows[0].count);

      const totalHistoryResult = await pgClient.query('SELECT COUNT(*) as count FROM points_history');
      const totalHistory = parseInt(totalHistoryResult.rows[0].count);

      // Resetar todos os pontos do sistema
      await pgClient.query('DELETE FROM points_history');
      await pgClient.query('DELETE FROM user_points');

      const resetEmbed = new EmbedBuilder()
        .setTitle('🔄 SISTEMA DE PONTOS RESETADO')
        .setDescription(`
**Sistema completamente resetado!**

✅ **Ações realizadas:**
• **${totalUsers}** usuários tiveram pontos zerados
• **${totalHistory}** registros de histórico removidos
• Rankings completamente limpos
• Todos os contadores reiniciados

**📊 DADOS REMOVIDOS:**
• Pontos de entregas, VIP, edição
• Pontos de recrutamento, verificação, suporte
• Histórico completo de atividades
• Estatísticas de progresso

**Resetado por:** ${message.author}
**Data:** ${new Date().toLocaleString('pt-BR')}

> 🔄 *O sistema está pronto para começar do zero*
`)
        .setColor('#ff6b6b')
        .addFields(
          { 
            name: '👥 Usuários Afetados', 
            value: `${totalUsers} usuários`, 
            inline: true 
          },
          { 
            name: '📝 Histórico Removido', 
            value: `${totalHistory} registros`, 
            inline: true 
          },
          { 
            name: '🕒 Processamento', 
            value: `Instantâneo`, 
            inline: true 
          }
        )
        .setFooter({ text: 'SISTEMA DE PONTOS GIFZADA • Reset Completo' })
        .setTimestamp();

      await message.reply({ embeds: [resetEmbed] });

      console.log(`Sistema de pontos resetado por ${message.author.username} (${message.author.id}) - ${totalUsers} usuários, ${totalHistory} registros removidos`);
    } catch (error) {
      console.error('Erro ao resetar sistema de pontos:', error);
      await message.reply('❌ Erro ao resetar sistema de pontos. Tente novamente.');
    }
    return;
  }

  // Comando !pontos reset (apenas administradores) - Mantido para compatibilidade
  if (message.content === '!pontos reset') {
    const adminRoles = ['1385756391284805713', '1065441743379628043', '1065441744726020126', '1386493660010516693', '1317652394351525959'];
    const hasAdminRole = message.member && message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasAdminRole) {
      return message.reply('❌ Apenas administradores podem usar este comando.');
    }

    try {
      // Resetar todos os pontos do sistema
      await pgClient.query('DELETE FROM points_history');
      await pgClient.query('DELETE FROM user_points');

      const resetEmbed = new EmbedBuilder()
        .setTitle('🔄 SISTEMA DE PONTOS RESETADO')
        .setDescription(`
**Sistema completamente resetado!**

✅ **Ações realizadas:**
• Todos os pontos foram zerados
• Histórico de atividades limpo
• Rankings resetados
• Contadores reiniciados

**Resetado por:** ${message.author}
**Data:** ${new Date().toLocaleString('pt-BR')}

> 🔄 *O sistema está pronto para começar do zero*
`)
        .setColor('#ff6b6b')
        .setFooter({ text: 'SISTEMA DE PONTOS GIFZADA' })
        .setTimestamp();

      await message.reply({ embeds: [resetEmbed] });

      console.log(`Sistema de pontos resetado por ${message.author.username} (${message.author.id})`);
    } catch (error) {
      console.error('Erro ao resetar sistema de pontos:', error);
      await message.reply('❌ Erro ao resetar sistema de pontos. Tente novamente.');
    }
    return;
  }

  // Comando !gifzada
  if (message.content === '!gifzada') {
    try {
      const userId = message.author.id;
      const user = message.author;

      // Função para verificar bio com múltiplas tentativas
      const checkBioWithRetries = async (maxRetries = 3) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`[TENTATIVA ${attempt}/${maxRetries}] Buscando perfil de ${user.username} (${userId})`);

            // Limpar cache antes de buscar novamente
            client.users.cache.delete(userId);

            // Buscar perfil com cache forçado
            const fetchedUser = await client.users.fetch(userId, { 
              force: true,
              cache: false 
            });

            // Aguardar baseado na tentativa (mais tempo a cada tentativa)
            const waitTime = attempt * 2000; // 2s, 4s, 6s
            console.log(`[TENTATIVA ${attempt}] Aguardando ${waitTime}ms para sincronização...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));

            // Verificar bio
            const userBio = fetchedUser.bio || '';
            console.log(`[TENTATIVA ${attempt}] Bio encontrada: "${userBio}"`);
            console.log(`[TENTATIVA ${attempt}] Tamanho da bio: ${userBio.length} caracteres`);

            // Verificar se tem /gifs (várias variações)
            const variations = ['/gifs', '/gif', 'gifs', 'gif'];
            const foundVariations = [];

            for (const variation of variations) {
              if (userBio.toLowerCase().includes(variation.toLowerCase())) {
                foundVariations.push(variation);
              }
            }

            console.log(`[TENTATIVA ${attempt}] Variações encontradas: [${foundVariations.join(', ')}]`);

            const hasGifs = foundVariations.length > 0;

            if (hasGifs || attempt === maxRetries) {
              return {
                hasGifs,
                bio: userBio,
                foundVariations,
                attempt
              };
            }

            console.log(`[TENTATIVA ${attempt}] /gifs não encontrado, tentando novamente...`);

          } catch (error) {
            console.error(`[TENTATIVA ${attempt}] Erro ao buscar perfil:`, error);
            if (attempt === maxRetries) {
              throw error;
            }
          }
        }
      };

      console.log(`\n=== INICIANDO VERIFICAÇÃO DE BIO PARA ${user.username} ===`);
      const bioCheck = await checkBioWithRetries(3);
      console.log(`=== RESULTADO FINAL: ${bioCheck.hasGifs ? 'ENCONTRADO' : 'NÃO ENCONTRADO'} ===\n`);

      if (!bioCheck.hasGifs) {
        const errorEmbed = new EmbedBuilder()
          .setTitle(' **REQUISITO NÃO ATENDIDO**')
          .setDescription(`
**Para receber o cargo, você precisa ter \`/gifs\` no seu "sobre mim" do Discord!**

** COMO FAZER:**
1. Vá nas configurações do Discord (⚙️)
2. Clique em "Profile" (Perfil) ou "Perfil"
3. Edite a seção "About me" (Sobre mim)
4. Adicione exatamente \`/gifs\` na descrição
5. Salve as alterações
6. **REINICIE o Discord completamente**
7. Aguarde 3-5 minutos
8. Use o comando novamente

** IMPORTANTE:**
• Use o perfil **GLOBAL** (não do servidor)
• O texto deve ser exatamente \`/gifs\` (com barra)
• Pode estar em qualquer parte da descrição
• **REINICIAR o Discord é essencial** para sincronizar
• Se ainda não funcionar, aguarde mais tempo

**📊 DIAGNÓSTICO DA VERIFICAÇÃO:**
• **Tentativas realizadas:** ${bioCheck.attempt}/3
• **Bio atual detectada:** 
\`\`\`
${bioCheck.bio || 'Nenhuma descrição encontrada'}
\`\`\`
• **Tamanho:** ${bioCheck.bio ? bioCheck.bio.length : 0} caracteres
• **Variações buscadas:** /gifs, /gif, gifs, gif
• **Status:** ❌ Nenhuma variação encontrada

**🔧 SOLUÇÕES:**
1. **Reinicie o Discord** (importante!)
2. Aguarde 5 minutos após adicionar /gifs
3. Certifique-se que está no perfil GLOBAL
4. Tente usar exatamente: \`/gifs\`
`)
          .setColor('#ff4444')
          .setFooter({ text: 'SISTEMA /GIFS GIFZADA' })
          .setTimestamp();

        return message.reply({ embeds: [errorEmbed] });
      }

      console.log(`Bio verificada com sucesso para ${user.username}: "${bioCheck.bio}"`);
      console.log(`Variações /gifs encontradas: [${bioCheck.foundVariations.join(', ')}]`);

      // Verificar se o usuário já possui o cargo
      const gifsRoleId = '1399533593360990421';
      const member = message.member;

      if (member.roles.cache.has(gifsRoleId)) {
        return message.reply(' Você já possui o cargo `GIFZADA`!');
      }

      // Adicionar o cargo
      await member.roles.add(gifsRoleId);

      // Salvar no banco de dados para monitoramento
      await pgClient.query(`
        INSERT INTO gifs_users (user_id, username, granted_at, last_checked, has_gifs_in_profile)
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = $2,
          granted_at = CURRENT_TIMESTAMP,
          last_checked = CURRENT_TIMESTAMP,
          has_gifs_in_profile = TRUE
      `, [userId, user.username]);

      const successEmbed = new EmbedBuilder()
        .setTitle('🎉 **CARGO /GIFS CONCEDIDO!**')
        .setDescription(`
**Parabéns ${user}!**

✅ **Cargo concedido:** <@&${gifsRoleId}>
🎯 **Perfil verificado:** Sobre mim contém /gifs
📅 **Concedido em:** ${new Date().toLocaleString('pt-BR')}
📝 **Bio detectada:** "${bioCheck.bio}"
🔍 **Variações encontradas:** ${bioCheck.foundVariations.join(', ')}
📊 **Verificado na tentativa:** ${bioCheck.attempt}/3

**📋 INFORMAÇÕES IMPORTANTES:**
• Mantenha \`/gifs\` no "sobre mim" do seu perfil global
• **Verificação automática:** Todo sábado às 10h
• Se remover \`/gifs\` da descrição, o cargo será removido automaticamente
• Para manter o cargo, sempre tenha \`/gifs\` visível na descrição

**💡 DICA:** Você pode personalizar sua descrição, mas sempre mantenha \`/gifs\` em qualquer lugar!

> 🔄 *Sistema de monitoramento ativo*
`)
        .setColor('#00ff88')
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'SISTEMA /GIFS GIFZADA' })
        .setTimestamp();

      await message.reply({ embeds: [successEmbed] });

      console.log(`✅ CARGO /GIFS CONCEDIDO: ${user.username} (${userId})`);
      console.log(`   Bio: "${bioCheck.bio}"`);
      console.log(`   Variações: [${bioCheck.foundVariations.join(', ')}]`);
      console.log(`   Tentativa: ${bioCheck.attempt}/3\n`);

    } catch (error) {
      console.error('❌ ERRO no comando !gifzada:', error);
      console.log(`   Usuário: ${user.username} (${userId})`);
      console.log(`   Erro: ${error.message}\n`);
      await message.reply(`❌ Erro ao processar comando: ${error.message}\n\n🔧 **Soluções:**\n• Reinicie o Discord completamente\n• Aguarde 5 minutos após adicionar /gifs na bio\n• Tente novamente`);
    }
    return;
  }

  // Comando !criarwebhook
  if (message.content.startsWith('!criarwebhook')) {
    // Verificar se o usuário tem permissão (apenas administradores)
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasAdminRole = message.member && message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasAdminRole) {
      return message.reply('❌ Apenas administradores podem criar webhooks.');
    }

    const args = message.content.split(' ');
    
    // Verificar se foi fornecido um canal
    if (args.length < 2) {
      return message.reply('❌ **Uso correto:** `!criarwebhook #canal [nome]`\n\n**Exemplo:** `!criarwebhook #general Webhook Bot`');
    }

    // Extrair canal mencionado ou ID
    let targetChannel = null;
    
    if (message.mentions.channels.size > 0) {
      targetChannel = message.mentions.channels.first();
    } else {
      // Tentar buscar por ID
      const channelId = args[1].replace(/[<#>]/g, '');
      targetChannel = message.guild.channels.cache.get(channelId);
    }

    if (!targetChannel) {
      return message.reply('❌ Canal não encontrado. Use `#canal` ou forneça um ID válido.');
    }

    // Verificar se é um canal de texto
    if (targetChannel.type !== 0) { // GUILD_TEXT
      return message.reply('❌ Apenas canais de texto suportam webhooks.');
    }

    // Nome do webhook (padrão ou personalizado)
    const webhookName = args.slice(2).join(' ') || `Webhook - ${targetChannel.name}`;

    try {
      // Criar webhook
      const webhook = await targetChannel.createWebhook({
        name: webhookName,
        avatar: message.guild.iconURL({ dynamic: true, size: 512 }) || client.user.displayAvatarURL({ dynamic: true, size: 512 }),
        reason: `Webhook criado por ${message.author.tag} (${message.author.id})`
      });

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ **WEBHOOK CRIADO COM SUCESSO**')
        .setDescription(`
**Webhook criado no canal ${targetChannel}!**

**📋 INFORMAÇÕES:**
• **Nome:** ${webhookName}
• **Canal:** ${targetChannel} (${targetChannel.name})
• **ID:** \`${webhook.id}\`
• **URL:** ||${webhook.url}||

**👤 CRIADO POR:**
• **Usuário:** ${message.author}
• **Data:** ${new Date().toLocaleString('pt-BR')}

**⚙️ CONFIGURAÇÕES:**
• **Avatar:** Ícone do servidor
• **Permissões:** Enviar mensagens no canal

> ⚠️ **IMPORTANTE:** Mantenha a URL do webhook em segurança. Qualquer pessoa com acesso à URL pode enviar mensagens através dele.
`)
        .setColor('#00ff88')
        .setThumbnail(webhook.avatarURL({ dynamic: true, size: 256 }) || client.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { 
            name: '🔗 **Como usar**', 
            value: `\`\`\`\nPOST ${webhook.url}\nContent-Type: application/json\n\n{\n  "content": "Sua mensagem aqui",\n  "username": "Nome personalizado",\n  "avatar_url": "URL do avatar"\n}\`\`\``, 
            inline: false 
          }
        )
        .setFooter({ 
          text: 'SISTEMA DE WEBHOOKS GIFZADA',
          iconURL: message.guild.iconURL({ dynamic: true, size: 64 })
        })
        .setTimestamp();

      await message.reply({ embeds: [successEmbed] });

      console.log(`Webhook criado: ${webhookName} no canal ${targetChannel.name} por ${message.author.tag}`);

    } catch (error) {
      console.error('Erro ao criar webhook:', error);
      
      let errorMessage = '❌ Erro ao criar webhook.';
      
      if (error.code === 50013) {
        errorMessage = '❌ Não tenho permissão para criar webhooks neste canal.';
      } else if (error.code === 30007) {
        errorMessage = '❌ Limite máximo de webhooks atingido neste canal (10 webhooks por canal).';
      } else if (error.code === 50001) {
        errorMessage = '❌ Não tenho acesso a este canal.';
      }

      await message.reply(`${errorMessage}\n\n**Detalhes técnicos:** \`${error.message}\``);
    }
    return;
  }

  // Comando !pontosranking
  if (message.content === '!pontosranking') {
    try {
      const ranking = await getPointsRanking(20); // Top 20

      if (ranking.length === 0) {
        return message.reply(' Nenhum usuário com pontos registrados ainda.');
      }

      let rankingText = '';

      for (let i = 0; i < ranking.length; i++) {
        const user = ranking[i];
        let medal = '';

        if (i === 0) medal = '🥇';
        else if (i === 1) medal = '🥈';
        else if (i === 2) medal = '🥉';
        else medal = `**${i + 1}º**`;

        // Calcular total de atividades
        const totalAtividades = user.entregas_count + user.vip_count + user.edicao_count + 
                               user.encontrar_count + user.recrutamento_count + 
                               user.verificacao_count + user.suporte_count;

        rankingText += `${medal} **${user.username}**\n`;
        rankingText += `📊 **${user.total_points} pontos** • ${totalAtividades} atividades\n`;

        // Mostrar detalhamento das atividades principais
        let atividades = [];
        if (user.entregas_count > 0) atividades.push(`Entregas: ${user.entregas_count}`);
        if (user.vip_count > 0) atividades.push(`VIP: ${user.vip_count}`);
        if (user.edicao_count > 0) atividades.push(`Edição: ${user.edicao_count}`);
        if (user.encontrar_count > 0) atividades.push(`Encontrar: ${user.encontrar_count}`);
        if (user.recrutamento_count > 0) atividades.push(`Recrutamento: ${user.recrutamento_count}`);
        if (user.verificacao_count > 0) atividades.push(`Verificação: ${user.verificacao_count}`);
        if (user.suporte_count > 0) atividades.push(`Suporte: ${user.suporte_count}`);

        if (atividades.length > 0) {
          rankingText += `└ ${atividades.slice(0, 3).join(' • ')}${atividades.length > 3 ? '...' : ''}\n`;
        }

        rankingText += '\n';
      }

      const rankingEmbed = new EmbedBuilder()
        .setTitle('🏆 RANKING COMPLETO DE PONTOS')
        .setDescription(`
**TOP ${ranking.length} USUÁRIOS COM MAIS PONTOS**

${rankingText}

**📈 SISTEMA DE PONTUAÇÃO:**
• **Entregas:** 2 pontos cada
• **VIP:** 4 pontos cada
• **Edição:** 3 pontos cada
• **Encontrar:** 1 ponto cada
• **Recrutamento:** 1 ponto cada
• **Verificação:** 1 ponto cada
• **Suporte:** 1 ponto cada

> 💡 *Use \`!pontos\` para ver suas estatísticas detalhadas*
`)
        .setColor('#FFD700')
        .setFooter({ 
          text: `Sistema de Pontos GIFZADA • Atualizado em ${new Date().toLocaleDateString('pt-BR')}` 
        })
        .setTimestamp();

      await message.reply({ embeds: [rankingEmbed] });

    } catch (error) {
      console.error('Erro no comando !pontosranking:', error);
      await message.reply('❌ Erro ao buscar ranking de pontos. Tente novamente.');
    }
    return;
  }

  // Comando !pontos antigo (manter compatibilidade)
  if (message.content.startsWith('!pontos ')) {
    const args = message.content.split(' ');
    let targetUser = message.author;

    // Se foi mencionado um usuário, usar esse usuário
    if (message.mentions.users.size > 0) {
      targetUser = message.mentions.users.first();
    } 
    // Se foi fornecido um ID, tentar buscar o usuário
    else if (args[1]) {
      try {
        targetUser = await client.users.fetch(args[1]);
      } catch (error) {
        console.error('Erro ao buscar usuário:', error);
      }
    }

    // Subcomandos administrativos
    if (args[1] === 'ranking') {
      try {
        const ranking = await getPointsRanking(10);

        if (ranking.length === 0) {
          return message.reply('📊 Nenhum usuário com pontos registrados ainda.');
        }

        let rankingText = '🏆 **TOP 10 RANKING DE PONTOS:**\n\n';

        for (let i = 0; i < ranking.length; i++) {
          const user = ranking[i];
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
          rankingText += `${medal} **${user.username}** - ${user.total_points} pontos\n`;
        }

        const rankingEmbed = new EmbedBuilder()
          .setTitle('🏆 RANKING DE PONTOS')
          .setDescription(rankingText)
          .setColor('#FFD700')
          .setTimestamp();

        return message.reply({ embeds: [rankingEmbed] });
      } catch (error) {
        console.error('Erro ao buscar ranking:', error);
        return message.reply('❌ Erro ao buscar ranking de pontos.');
      }
    }

    if (args[1] === 'historico' && args[2]) {
      try {
        const userId = args[2].replace(/[<@!>]/g, '');
        const history = await getUserPointsHistory(userId, 15);

        if (history.length === 0) {
          return message.reply('📊 Nenhum histórico de pontos encontrado para este usuário.');
        }

        let historyText = '📜 **HISTÓRICO DE PONTOS:**\n\n';

        history.forEach(entry => {
          const date = new Date(entry.created_at).toLocaleDateString('pt-BR');
          historyText += `• **${entry.activity_type}** (+${entry.points_earned} pontos) - ${date}\n`;
          if (entry.description) {
            historyText += `  ${entry.description}\n`;
          }
        });

        const historyEmbed = new EmbedBuilder()
          .setTitle('📜 HISTÓRICO DE PONTOS')
          .setDescription(historyText)
          .setColor('#4169e1')
          .setTimestamp();

        return message.reply({ embeds: [historyEmbed] });
      } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        return message.reply('❌ Erro ao buscar histórico de pontos.');
      }
    }

    try {
      // Buscar pontos do usuário no banco de dados
      const userPoints = await getUserPoints(targetUser.id);

      if (!userPoints) {
        // Se não existe no banco, criar entrada inicial
        await createOrUpdateUserPoints(targetUser.id, targetUser.displayName || targetUser.username);

        const newUserEmbed = new EmbedBuilder()
          .setTitle('📊 ESTATÍSTICAS DE PONTOS')
          .setDescription(`
**Usuário:** ${targetUser.displayName || targetUser.username}
**ID:** ${targetUser.id}

**Pontos Totais:** 0

**Detalhamento:**
• **Entregas:** 0 (0 pontos)
• **VIP:** 0 (0 pontos)
• **Edição:** 0 (0 pontos)
• **Encontrar:** 0 (0 pontos)
• **Recrutamento:** 0 (0 pontos)
• **Verificação:** 0 (0 pontos)
• **Suporte:** 0 (0 pontos)

*Usuário registrado no sistema de pontos!*
`)
          .setColor('#9c41ff')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        return message.reply({ embeds: [newUserEmbed] });
      }

      // Calcular pontos detalhados
      const entregasPontos = userPoints.entregas_count * 2;
      const vipPontos = userPoints.vip_count * 4;
      const edicaoPontos = userPoints.edicao_count * 3;
      const encontrarPontos = userPoints.encontrar_count * 1;
      const recrutamentoPontos = userPoints.recrutamento_count * 1;
      const verificacaoPontos = userPoints.verificacao_count * 1;
      const suportePontos = userPoints.suporte_count * 1;

      const pointsEmbed = new EmbedBuilder()
        .setTitle('📊 ESTATÍSTICAS DE PONTOS')
        .setDescription(`
**Usuário:** ${userPoints.username}
**ID:** ${targetUser.id}

**Pontos Totais:** ${userPoints.total_points}

**ATIVIDADES DE MAKER:**
• **Entregas:** ${userPoints.entregas_count} (${entregasPontos} pontos)
• **VIP:** ${userPoints.vip_count} (${vipPontos} pontos)
• **Edição:** ${userPoints.edicao_count} (${edicaoPontos} pontos)
• **Encontrar:** ${userPoints.encontrar_count} (${encontrarPontos} pontos)

**ATIVIDADES DE STAFF:**
• **Recrutamento:** ${userPoints.recrutamento_count} (${recrutamentoPontos} pontos)
• **Verificação:** ${userPoints.verificacao_count} (${verificacaoPontos} pontos)
• **Suporte:** ${userPoints.suporte_count} (${suportePontos} pontos)

**Última atualização:** ${new Date(userPoints.last_updated).toLocaleDateString('pt-BR')}
`)
        .setColor('#9c41ff')
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'Use !pontos ranking para ver o ranking geral' })
        .setTimestamp();

      await message.reply({ embeds: [pointsEmbed] });

    } catch (error) {
      console.error('Erro no comando !pontos:', error);
      await message.reply('❌ Erro ao buscar as estatísticas. Tente novamente.');
    }
  }
});

// Listener para banimentos - enviar log quando um usuário for banido
client.on('guildBanAdd', async ban => {
  try {
    const logChannelId = '1374832443814580244';
    const logChannel = client.channels.cache.get(logChannelId);

    if (!logChannel) {
      console.log('Canal de log de banimentos não encontrado');
      return;
    }

    // Buscar informações sobre o banimento
    const bannedUser = ban.user;
    const guild = ban.guild;

    // Buscar logs de auditoria para encontrar quem executou o ban
    let executor = null;
    let reason = 'Não especificado';

    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: 22, // MEMBER_BAN_ADD
        limit: 1
      });

      const banLog = auditLogs.entries.first();
      if (banLog && banLog.target.id === bannedUser.id) {
        executor = banLog.executor;
        reason = banLog.reason || 'Não especificado';
      }
    } catch (auditError) {
      console.error('Erro ao buscar logs de auditoria:', auditError);
    }

    // Criar embed do log de banimento
    const banLogEmbed = new EmbedBuilder()
      .setTitle('🔨 **USUÁRIO BANIDO**')
      .setDescription(`
**Usuário banido:** ${bannedUser.tag} (${bannedUser.id})
**Executado por:** ${executor ? `${executor.tag} (${executor.id})` : 'Sistema/Desconhecido'}
**Servidor:** ${guild.name}

**Motivo:**
\`\`\`
${reason}
\`\`\`

**Data do banimento:** ${new Date().toLocaleString('pt-BR')}
`)
      .setColor('#ff4444')
      .setThumbnail(bannedUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { 
          name: '👤 **Informações do Usuário**', 
          value: `**Tag:** ${bannedUser.tag}\n**ID:** ${bannedUser.id}\n**Conta criada:** ${bannedUser.createdAt.toLocaleDateString('pt-BR')}`, 
          inline: true 
        },
        { 
          name: '⚖️ **Informações da Ação**', 
          value: `**Staff:** ${executor ? executor.tag : 'Desconhecido'}\n**Método:** Ban direto\n**Servidor:** ${guild.name}`, 
          inline: true 
        }
      )
      .setFooter({ text: 'SISTEMA DE LOGS DE BANIMENTO' })
      .setTimestamp();

    await logChannel.send({ embeds: [banLogEmbed] });

    console.log(`Log de banimento enviado: ${bannedUser.tag} banido por ${executor ? executor.tag : 'Desconhecido'}`);

  } catch (error) {
    console.error('Erro ao enviar log de banimento:', error);
  }
});

client.on('interactionCreate', async interaction => {
  // Verificar se a interação ainda é válida
  if (interaction.replied || interaction.deferred) {
    console.log('Interação já foi processada, ignorando');
    return;
  }

  // Verificar se a interação não expirou (mais de 2.5 segundos)
  const interactionAge = Date.now() - interaction.createdTimestamp;
  if (interactionAge > 2500) {
    console.log(`Interação expirada (${interactionAge}ms), ignorando`);
    return;
  }

  // Handler para comandos slash
  if (interaction.isChatInputCommand()) {
    const { commandName, member, channel, options } = interaction;

    // IDs dos cargos autorizados para usar os comandos
    const authorizedRoles = [
      '1065441747305508916',
      '1065441745875243008',
      '1386492093303885907',
      '1317652394351525959',
      '1386493660010516693',
      '1065441744726020126',
      '1065441743379628043',
      '1065441742301704202'
    ];

    // Verificar se o member existe
    if (!member) {
      return interaction.reply({
        content: '❌ Não foi possível verificar suas permissões. Tente novamente.',
       flags: 1 << 6
      });
    }

    // Verificar permissões específicas por comando (exceto solicitarban que tem sua própria verificação)
    if (commandName !== 'solicitarban') {
      const hasAuthorizedRole = member.roles.cache.some(role => authorizedRoles.includes(role.id));

      if (!hasAuthorizedRole) {
        return interaction.reply({
          content: '❌ Você não tem permissão para usar este comando. Apenas membros da staff podem usar comandos de bloqueio/desbloqueio.',
         flags: 1 << 6
        });
      }
    }

    if (commandName === 'lock') {
      try {
        // Bloquear o canal para @everyone
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
          SendMessages: false,
          AddReactions: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false
        });

        const lockEmbed = new EmbedBuilder()
          .setTitle('Canal Fechado')
          .setDescription('Este canal foi fechado com sucesso!')
          .setColor('#9c41ff')
          .setTimestamp()
          .setFooter({ text: `Fechado por ${interaction.user.username}` });

        await interaction.reply({ embeds: [lockEmbed],flags: 1 << 6 });
      } catch (error) {
        console.error('Erro ao fechar canal:', error);
        await interaction.reply({
          content: '❌ Erro ao fechar o canal. Verifique se o bot tem as permissões necessárias.',
         flags: 1 << 6
        });
      }
    }

    if (commandName === 'unlock') {
      try {
        // Desbloquear o canal para @everyone com permissões explícitas
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
          SendMessages: true,
          AddReactions: true,
          CreatePublicThreads: true,
          CreatePrivateThreads: true
        });

        const unlockEmbed = new EmbedBuilder()
          .setTitle('Canal Aberto')
          .setDescription('Este canal foi aberto e todos os membros podem enviar mensagens novamente.')
          .setColor('#9c41ff')
          .setTimestamp()
          .setFooter({ text: `Aberto por ${interaction.user.username}` });

        await interaction.reply({ embeds: [unlockEmbed],flags: 1 << 6 });
      } catch (error) {
        console.error('Erro ao abrir canal:', error);
        await interaction.reply({
          content: '❌ Erro ao abrir o canal. Verifique se o bot tem as permissões necessárias.',
         flags: 1 << 6
        });
      }
    }

    if (commandName === 'rec-staff') {
      // Verificar se é staff
      const staffRoleId = '1094385139976507523';
      const hasStaffRole = member.roles.cache.has(staffRoleId);

      if (!hasStaffRole) {
        return interaction.reply({
          content: '❌ Apenas membros da staff podem usar este comando.',
         flags: 1 << 6
        });
      }

      const targetUser = interaction.options.getUser('usuario');
      const targetMember = interaction.guild.members.cache.get(targetUser.id);

      if (!targetMember) {
        return interaction.reply({
          content: '❌ Usuário não encontrado no servidor.',
         flags: 1 << 6
        });
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('Confirmação de Recrutamento - STAFF')
        .setDescription(`
**Confirme abaixo os dados antes de setar o cargo**

**Usuário:** ${targetUser.username} (${targetUser})

**Cargos que serão adicionados:**
• <@&1065441749947928656>
• <@&1065441764460199967>
• <@&1094385139976507523>
• <@&1224755216038236232>
• <@&1072027317297229875>
`)
        .setColor('#9c41ff')
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_maker_${targetUser.id}`)
          .setLabel('Confirmar')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('cancel_recruitment')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        embeds: [confirmEmbed],
        components: [confirmRow],
       flags: 1 << 6
      });
    }

    if (commandName === 'rec-postador') {
      // Verificar se é staff
      const staffRoleId = '1094385139976507523';
      const hasStaffRole = member.roles.cache.has(staffRoleId);

      if (!hasStaffRole) {
        return interaction.reply({
          content: '❌ Apenas membros da staff podem usar este comando.',
         flags: 1 << 6
        });
      }

      const targetUser = interaction.options.getUser('usuario');
      const targetMember = interaction.guild.members.cache.get(targetUser.id);

      if (!targetMember) {
        return interaction.reply({
          content: '❌ Usuário não encontrado no servidor.',
         flags: 1 << 6
        });
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('Confirmação de Recrutamento - POSTADOR')
        .setDescription(`
**Confirme abaixo os dados antes de setar o cargo**

**Usuário:** ${targetUser.username} (${targetUser})

**Cargo que será adicionado:**
• <@&1072027317297229875>
`)
        .setColor('#9c41ff')
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_postador_${targetUser.id}`)
          .setLabel('Confirmar')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('cancel_recruitment')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        embeds: [confirmEmbed],
        components: [confirmRow],
       flags: 1 << 6
      });
    }

    if (commandName === 'postar') {
      const texto = options.getString('texto');
      const mencionar = options.getUser('mencionar');
      const anonimo = options.getBoolean('anonimo') || false;
      const modoEscuro = options.getBoolean('modo_escuro') || false;

      try {
        // Defer a resposta para ter mais tempo de processamento
        await interaction.deferReply();

        // Criar a imagem da postagem
        const imagemBuffer = await criarPostagemTwitter(interaction.user, texto, mencionar, anonimo, modoEscuro);

        // Criar attachment
        const attachment = new AttachmentBuilder(imagemBuffer, { name: 'postagem.png' });

        // Enviar a postagem no canal
        await interaction.channel.send({
          files: [attachment]
        });

        // Não enviar resposta ao usuário (fazer dismiss silencioso)
        await interaction.editReply({
          content: 'Postagem enviada!',
        });

        // Deletar a resposta após 500ms
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch (error) {
            console.log('Resposta já foi deletada ou expirou');
          }
        }, 100);

      } catch (error) {
        console.error('Erro ao criar postagem:', error);
        await interaction.editReply({
          content: '❌ Erro ao criar a postagem. Tente novamente.',
        });
      }
    }

    if (commandName === 'solicitarban') {
      // Verificar se o usuário tem os cargos específicos para solicitar banimento
      const authorizedRolesForBan = ['1094385139976507523', '1224755216038236232'];
      const hasAuthorizedRoleForBan = member.roles.cache.some(role => authorizedRolesForBan.includes(role.id));

      if (!hasAuthorizedRoleForBan) {
        return interaction.reply({
          content: '❌ Você não tem permissão para usar este comando. Apenas membros com cargos específicos podem solicitar banimentos.',
          flags: 1 << 6
        });
      }

      // Verificar se está no canal correto
      if (interaction.channel.id !== '1399541233650499785') {
        return interaction.reply({
          content: '❌ Este comando só pode ser usado no canal específico para solicitações de ban.',
          flags: 1 << 6
        });
      }

      const targetUser = options.getUser('usuario');
      const anexo = options.getAttachment('anexo');
      const motivo = options.getString('motivo');

      try {
        // Criar ID único para a solicitação
        const solicitacaoId = `ban_${Date.now()}_${interaction.user.id}`;

        // Embed para confirmação de envio
        const confirmEmbed = new EmbedBuilder()
          .setTitle('✅ **SOLICITAÇÃO ENVIADA**')
          .setDescription(`
**Sua solicitação de banimento foi enviada com sucesso!**

**Usuário relatado:** ${targetUser}
**Motivo:** ${motivo}
**Solicitado por:** ${interaction.user}
**Data:** ${new Date().toLocaleString('pt-BR')}

> 📋 *Sua solicitação está sendo analisada pela administração.*
`)
          .setColor('#ffaa00')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        const verProvaButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ver_prova_solicitacao_${solicitacaoId}`)
            .setLabel('Ver Prova')
            .setEmoji('📎')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ 
          embeds: [confirmEmbed], 
          components: [verProvaButton], 
          flags: 1 << 6 
        });

        // Enviar para canal de análise
        const analiseChannel = client.channels.cache.get('1399542249682895040');

        if (analiseChannel) {
          const analiseEmbed = new EmbedBuilder()
            .setTitle('🚨 **NOVA SOLICITAÇÃO DE BANIMENTO**')
            .setDescription(`
**Usuário para banir:** ${targetUser} (${targetUser.id})
**Solicitado por:** ${interaction.user}
**Canal:** ${interaction.channel}

**Motivo:**
\`\`\`
${motivo}
\`\`\`

**Data da solicitação:** ${new Date().toLocaleString('pt-BR')}
**ID da solicitação:** \`${solicitacaoId}\`
`)
            .setColor('#ff4444')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `Solicitação: ${solicitacaoId}` })
            .setTimestamp();

          const analiseButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`aprovar_ban_${solicitacaoId}`)
              .setLabel('Aprovar Banimento')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`ver_prova_analise_${solicitacaoId}`)
              .setLabel('Ver Prova')
              .setEmoji('📎')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`rejeitar_ban_${solicitacaoId}`)
              .setLabel('Rejeitar Banimento')
              .setEmoji('❌')
              .setStyle(ButtonStyle.Secondary)
          );

          await analiseChannel.send({
            content: `<@&1065441743379628043>`,
            embeds: [analiseEmbed],
            components: [analiseButtons]
          });

          // Salvar dados da solicitação no mapa temporário
          if (!global.banSolicitations) global.banSolicitations = new Map();
          global.banSolicitations.set(solicitacaoId, {
            targetUserId: targetUser.id,
            targetUserTag: targetUser.tag,
            requesterId: interaction.user.id,
            requesterTag: interaction.user.tag,
            motivo: motivo,
            anexoUrl: anexo.url,
            anexoName: anexo.name,
            channelId: interaction.channel.id,
            originalMessageId: null, // Será definido após resposta
            analiseMessageId: null,
            status: 'pendente'
          });
        }

      } catch (error) {
        console.error('Erro no comando solicitarban:', error);
        await interaction.reply({
          content: '❌ Erro ao processar solicitação de banimento. Tente novamente.',
          flags: 1 << 6
        });
      }
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    // Handler para modal de Seja Maker
    if (interaction.customId === 'seja_maker_modal') {
      // Verificar se usuário está na blacklist
      const blacklistCheck = await isUserBlacklisted(interaction.user.id);
      if (blacklistCheck) {
        return interaction.reply({
          content: `**Você está na blacklist de recrutamento**\n\n**Motivo:** ${blacklistCheck.reason}\n\nEntre em contato com a equipe de recrutamento para mais informações.`,
         flags: 1 << 6
        });
      }

      // Verificar se já tem thread ativa (qualquer tipo)
      const activeThread = await hasActiveThread(interaction.user.id);
      if (activeThread) {
        const threadChannel = client.channels.cache.get(activeThread.thread_id);
        if (threadChannel && !threadChannel.archived) {
          return interaction.reply({
            content: `❌ **Você já possui um ticket ativo!**\n\nTipo: ${activeThread.thread_type}\nThread: ${threadChannel}\n\nFinalize ou feche seu ticket atual antes de abrir outro.`,
           flags: 1 << 6
          });
        } else {
          // Thread não existe mais, remover do banco
          await removeActiveThread(interaction.user.id);
        }
      }
      const nome = interaction.fields.getTextInputValue('nome');
      const idade = interaction.fields.getTextInputValue('idade');
      const foiMaker = interaction.fields.getTextInputValue('foi_maker');
      const objetivo = interaction.fields.getTextInputValue('objetivo');

      const starterMessage = await interaction.channel.send({
        content: '‎',
        allowedMentions: { users: [] }
      });

      const thread = await starterMessage.startThread({
        name: `📃・ ${interaction.user.id}`,
        autoArchiveDuration: 1440,
        reason: 'Candidatura para Maker'
      });

      starterMessage.delete().catch(() => {});

      const makerEmbed = new EmbedBuilder()
.setTitle('<:1266777381188931726:1266777381188931726> | JUNTE-SE À STAFF')
.setDescription(`
<:1266748851050774540:1266748851050774540> | Como staff, sua principal responsabilidade é garantir que o servidor funcione de forma organizada, acolhedora e ativa para todos os membros!

<:1269198470309220385:1269198470309220385> Sua missão é colaborar com a equipe, ajudar nas demandas da comunidade e contribuir para o crescimento do servidor com dedicação e comprometimento.


**Nome:**
${nome}
**Idade:**
${idade}
**Já foi maker de outro servidor de GIFS?**
${foiMaker}
**Objetivo a alcançar:**
${objetivo}

Caso nossa equipe de recrutamento esteja demorando para te atender, chame um staff!
`)
        .setColor('#9c41ff')
        .setImage('https://cdn.discordapp.com/attachments/1298115750665650176/1385776154748268574/image.png?ex=67932aa1&is=6791d921&hm=8e9c0b654de57f9e0b2f97daa92a0b89c3b75ddc9db00a4c7ea4da42a6b3c1ad&')
        .setFooter({ text: 'Obrigada por se interessar em entrar para a nossa equipe!' });

      const makerButtonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('assumir_ticket_maker')
          .setLabel('Assumir')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('chame_staff_maker')
          .setLabel('Chame um Staff')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('fechar_ticket_maker')
          .setLabel('Fechar Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await thread.send({ 
        content: `${interaction.user} <@&1230677503719374990>`, 
        embeds: [makerEmbed], 
        components: [makerButtonsRow] 
      });

      // Registrar thread ativa
      await addActiveThread(interaction.user.id, thread.id, 'Recrutamento - Maker');

      await interaction.reply({ 
        content: `**Seu ticket de recrutamento foi aberto com sucesso!** ${thread}`, 
       flags: 1 << 6 
      });
    }

    // Handler para modal de Seja Postador
    if (interaction.customId === 'seja_postador_modal') {
      // Verificar se usuário está na blacklist
      const blacklistCheck = await isUserBlacklisted(interaction.user.id);
      if (blacklistCheck) {
        return interaction.reply({
          content: `🚫 **Você está na blacklist de recrutamento**\n\n**Motivo:** ${blacklistCheck.reason}\n\nEntre em contato com a equipe de recrutamento para mais informações.`,
         flags: 1 << 6
        });
      }

      // Verificar se já tem thread ativa (qualquer tipo)
      const activeThread = await hasActiveThread(interaction.user.id);
      if (activeThread) {
        const threadChannel = client.channels.cache.get(activeThread.thread_id);
        if (threadChannel && !threadChannel.archived) {
          return interaction.reply({
            content: `❌ **Você já possui um ticket ativo!**\n\nTipo: ${activeThread.thread_type}\nThread: ${threadChannel}\n\nFinalize ou feche seu ticket atual antes de abrir outro.`,
           flags: 1 << 6
          });
        } else {
          // Thread não existe mais, remover do banco
          await removeActiveThread(interaction.user.id);
        }
      }
      const nome = interaction.fields.getTextInputValue('nome');
      const idade = interaction.fields.getTextInputValue('idade');
      const pretendeEquipe = interaction.fields.getTextInputValue('pretende_equipe');
      const conteudos = interaction.fields.getTextInputValue('conteudos');

      const starterMessage = await interaction.channel.send({
        content: '‎',
        allowedMentions: { users: [] }
      });

      const thread = await starterMessage.startThread({
        name: `📷・ ${interaction.user.id}`,
        autoArchiveDuration: 1440,
        reason: 'Candidatura para Postador'
      });

      starterMessage.delete().catch(() => {});

      const postadorEmbed = new EmbedBuilder()
        .setTitle('<:1266777381188931726:1266777381188931726> | GIFZADA - SEJA POSTADOR')
        .setDescription(`
<:1266748851050774540:1266748851050774540> | Como postador, sua principal obrigação é trazer conteúdo para o servidor!
<:1269198470309220385:1269198470309220385> Seu objetivo deve ser trazer conteúdo para nossos chats de forma padrão no servidor.

**Nome:**
${nome}
**Idade:**
${idade}
**Você pretende entrar para nossa equipe um dia?**
${pretendeEquipe}
**Onde você costuma pegar seus conteúdos?**
${conteudos}

Caso nossa equipe de recrutamento esteja demorando para te atender, chame um staff!
`)
        .setColor('#9c41ff')
        .setImage('https://cdn.discordapp.com/attachments/1298115750665650176/1385776154748268574/image.png?ex=67932aa1&is=6791d921&hm=8e9c0b654de57f9e0b2f97daa92a0b89c3b75ddc9db00a4c7ea4da42a6b3c1ad&')
        .setFooter({ text: 'Obrigada por se interessar em postar conteúdos no nosso servidor!' });

      const postadorButtonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('assumir_ticket_postador')
          .setLabel('Assumir Ticket')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('chame_staff_postador')
          .setLabel('Chame um Staff')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('fechar_ticket_postador')
          .setLabel('Fechar Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await thread.send({ 
        content: `${interaction.user} <@&1230677503719374990>`, 
        embeds: [postadorEmbed], 
        components: [postadorButtonsRow] 
      });

      // Registrar thread ativa
      await addActiveThread(interaction.user.id, thread.id, 'Recrutamento - Postador');

      await interaction.reply({ 
        content: `**Seu ticket de recrutamento foi aberto com sucesso!** ${thread}`, 
       flags: 1 << 6 
      });
    }

    // Handler para modal de Ajuda
    if (interaction.customId === 'ajuda_modal') {
      // Verificar se já tem thread ativa (qualquer tipo)
      const activeThread = await hasActiveThread(interaction.user.id);
      if (activeThread) {
        const threadChannel = client.channels.cache.get(activeThread.thread_id);
        if (threadChannel && !threadChannel.archived) {
          return interaction.reply({
            content: `❌ **Você já possui um ticket ativo!**\n\nTipo: ${activeThread.thread_type}\nThread: ${threadChannel}\n\nFinalize ou feche seu ticket atual antes de abrir outro.`,
           flags: 1 << 6
          });
        } else {
          // Thread não existe mais, remover do banco
          await removeActiveThread(interaction.user.id);
        }
      }
      const assunto = interaction.fields.getTextInputValue('assunto');
      const descricao = interaction.fields.getTextInputValue('descricao');

      const starterMessage = await interaction.channel.send({
        content: '‎',
        allowedMentions: { users: [] }
      });

      const thread = await starterMessage.startThread({
        name: `🆘・ ${interaction.user.id}`,
        autoArchiveDuration: 1440,
        reason: 'Ticket de Ajuda'
      });

      starterMessage.delete().catch(() => {});

      const ajudaEmbed = new EmbedBuilder()
        .setTitle('<:d_emoji_278:1366581300500365343>┊GIFZADA - AJUDA')
        .setDescription(`
<:d_emoji_273:1366581300500365343> | Ficamos felizes que você escolheu sanar sua dúvida conosco, sinta-se a vontade para conversar sobre.

1. Esclareça dúvidas sobre o servidor.
2. Relate problemas gerais do servidor.
3. Fale conosco sobre pedidos feitos por você.

**Ticket aberto por:** ${interaction.user}
**Motivo:** \`Solicitar ajuda.\`
**Assunto:** ${assunto}
**Descrição:** ${descricao}

Caso nossa equipe de suporte esteja demorando para te atender, chame um staff!
`)
        .setColor('#9c41ff')
        .setFooter({ text: 'Obrigada por entrar em contato conosco!' });

      const ajudaButtonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('assumir_ticket_ajuda')
          .setLabel('Assumir')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('chame_staff_ajuda')
          .setLabel('Chame um Staff')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('fechar_ticket_ajuda')
          .setLabel('Fechar Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await thread.send({ 
        content: `${interaction.user} <@&1165308513355046973>`, 
        embeds: [ajudaEmbed], 
        components: [ajudaButtonsRow] 
      });

      // Registrar thread ativa
      await addActiveThread(interaction.user.id, thread.id, 'Suporte - Ajuda');

      await interaction.reply({ 
        content: `**Seu ticket de suporte foi aberto com sucesso!** ${thread}`, 
       flags: 1 << 6 
      });
    }

    // Handler para modal de Denúncia
    if (interaction.customId === 'denuncia_modal') {
      // Verificar se já tem thread ativa (qualquer tipo)
      const activeThread = await hasActiveThread(interaction.user.id);
      if (activeThread) {
        const threadChannel = client.channels.cache.get(activeThread.thread_id);
        if (threadChannel && !threadChannel.archived) {
          return interaction.reply({
            content: `❌ **Você já possui um ticket ativo!**\n\nTipo: ${activeThread.thread_type}\nThread: ${threadChannel}\n\nFinalize ou feche seu ticket atual antes de abrir outro.`,
           flags: 1 << 6
          });
        } else {
          // Thread não existe mais, remover do banco
          await removeActiveThread(interaction.user.id);
        }
      }
      const assunto = interaction.fields.getTextInputValue('assunto');
      const descricao = interaction.fields.getTextInputValue('descricao');

      const starterMessage = await interaction.channel.send({
        content: '‎',
        allowedMentions: { users: [] }
      });

      const thread = await starterMessage.startThread({
        name: `⚠️・ ${interaction.user.id}`,
        autoArchiveDuration: 1440,
        reason: 'Ticket de Denúncia'
      });

      starterMessage.delete().catch(() => {});

      const denunciaEmbed = new EmbedBuilder()
        .setTitle('<:d_emoji_278:1366581300500365343>┊GIFZADA - DENÚNCIA')
        .setDescription(`
<:d_tag:1366581862004166656> | Ficamos felizes que você escolheu denunciar conosco, sinta-se a vontade para conversar sobre.

Denuncie membros que violaram nossas regras!
Divulgação inadequada via DM.
Problemas com nossos staffs

**Ticket aberto por:** ${interaction.user}
**Motivo:** \`Denunciar membro.\`
**Assunto:** ${assunto}
**Descrição:** ${descricao}

Caso nossa equipe de suporte esteja demorando para te atender, chame um staff!
`)
        .setColor('#9c41ff')
        .setFooter({ text: 'Obrigada por nos ajudar a manter o servidor seguro!' });

      const denunciaButtonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('assumir_ticket_denuncia')
          .setLabel('Assumir Ticket')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('chame_staff_denuncia')
          .setLabel('Chame um Staff')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('fechar_ticket_denuncia')
          .setLabel('Fechar Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await thread.send({ 
        content: `${interaction.user} <@&1165308513355046973>`, 
        embeds: [denunciaEmbed], 
        components: [denunciaButtonsRow] 
      });

      // Registrar thread ativa
      await addActiveThread(interaction.user.id, thread.id, 'Suporte - Denúncia');

      await interaction.reply({ 
        content: `**Seu ticket de denúncia foi aberto com sucesso!** ${thread}`, 
       flags: 1 << 6 
      });
    }

    // Handler para modal de Migração
    if (interaction.customId === 'migracao_modal') {
      // Verificar se usuário está na blacklist
      const blacklistCheck = await isUserBlacklisted(interaction.user.id);
      if (blacklistCheck) {
        return interaction.reply({
          content: `🚫 **Você está na blacklist de recrutamento**\n\n**Motivo:** ${blacklistCheck.reason}\n\nEntre em contato com a equipe de recrutamento para mais informações.`,
         flags: 1 << 6
        });
      }

      // Verificar se já tem thread ativa (qualquer tipo)
      const activeThread = await hasActiveThread(interaction.user.id);
      if (activeThread) {
        const threadChannel = client.channels.cache.get(activeThread.thread_id);
        if (threadChannel && !threadChannel.archived) {
          return interaction.reply({
            content: `❌ **Você já possui um ticket ativo!**\n\nTipo: ${activeThread.thread_type}\nThread: ${threadChannel}\n\nFinalize ou feche seu ticket atual antes de abrir outro.`,
           flags: 1 << 6
          });
        } else {
          // Thread não existe mais, remover do banco
          await removeActiveThread(interaction.user.id);
        }
      }
      const nome = interaction.fields.getTextInputValue('nome');
      const idade = interaction.fields.getTextInputValue('idade');
      const servidorOrigem = interaction.fields.getTextInputValue('servidor_origem');
      const motivoMigracao = interaction.fields.getTextInputValue('motivo_migracao');

      const starterMessage = await interaction.channel.send({
        content: '‎',
        allowedMentions: { users: [] }
      });

      const thread = await starterMessage.startThread({
        name: `✈️・ ${interaction.user.id}`,
        autoArchiveDuration: 1440,
        reason: 'Solicitação de Migração'
      });

      starterMessage.delete().catch(() => {});

      const migracaoEmbed = new EmbedBuilder()
        .setTitle('<:1266777381188931726:1266777381188931726> | GIFZADA - MIGRAÇÃO')
        .setDescription(`
<:1266748851050774540:1266748851050774540> | Como maker, sua principal obrigação é trazer conteúdo para o servidor atendendo à pedidos feitos pelos membros!
<:1269198470309220385:1269198470309220385> Seu objetivo deve ser upar para a staff de forma esforçada e comprometida.
Caso você já esteja vindo com cargo de staff, peça o auxílio de um superior em relação às suas funções.

**Nome:**
${nome}
**Idade:**
${idade}
**De qual servidor você está vindo?**
${servidorOrigem}
**Qual o motivo da sua migração?**
${motivoMigracao}

Caso nossa equipe de recrutamento esteja demorando para te atender, chame um staff!
`)
        .setColor('#9c41ff')
        .setFooter({ text: 'Obrigada por se interessar em entrar para a nossa equipe!' });

      const migracaoButtonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('assumir_ticket_migracao')
          .setLabel('Assumir Ticket')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('chame_staff_migracao')
          .setLabel('Chame um Staff')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('fechar_ticket_migracao')
          .setLabel('Fechar Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await thread.send({ 
        content: `${interaction.user} <@&1072640245482405940>`, 
        embeds: [migracaoEmbed], 
        components: [migracaoButtonsRow] 
      });

      // Registrar thread ativa
      await addActiveThread(interaction.user.id, thread.id, 'Recrutamento - Migração');

      await interaction.reply({ 
        content: `**Seu ticket de recrutamento foi aberto com sucesso!** ${thread}`, 
       flags: 1 << 6 
      });
    }

    // Handler para modal de comentários
    if (interaction.customId.startsWith('comment_modal_')) {
      const postId = interaction.customId.replace('comment_modal_', '');
      const commentText = interaction.fields.getTextInputValue('comment_text');

      try {
        await addComment(postId, interaction.user.id, commentText);
        await interaction.reply({ content: '💬 Comentário adicionado com sucesso!',flags: 1 << 6 });
      } catch (error) {
        console.error('Erro ao adicionar comentário:', error);
        if (error.message.includes('Limite de 2 comentários')) {
          await interaction.reply({ content: '❌ Você já atingiu o limite de 2 comentários por postagem.',flags: 1 << 6 });
        } else {
          await interaction.reply({ content: '❌ Erro ao adicionar comentário. Tente novamente.',flags: 1 << 6 });
        }
      }
    }

    // Handler para deletar comentário (autor)
    if (interaction.customId.startsWith('delete_comment_modal_')) {
      const postId = interaction.customId.replace('delete_comment_modal_', '');
      const commentNumber = parseInt(interaction.fields.getTextInputValue('comment_number'));

      if (!postComments.has(postId)) {
        return interaction.reply({ content: '❌ Post não encontrado.',flags: 1 << 6 });
      }

      const comments = postComments.get(postId);

      if (commentNumber < 1 || commentNumber > comments.length) {
        return interaction.reply({ content: '❌ Número de comentário inválido.',flags: 1 << 6 });
      }

      const deletedComment = comments[commentNumber - 1];
      comments.splice(commentNumber - 1, 1);

      // Atualizar contador de comentários do usuário
      const commentCounts = userCommentCount.get(postId) || new Map();
      const userCount = commentCounts.get(deletedComment.userId) || 0;
      if (userCount > 0) {
        commentCounts.set(deletedComment.userId, userCount - 1);
      }

      // Salvar no database
      saveDatabase();

      await interaction.reply({ content: '✅ Comentário deletado com sucesso!',flags: 1 << 6 });
    }

    // Handler para modal de bloquear usuário
    if (interaction.customId === 'admin_add_blacklist_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');
      const reason = interaction.fields.getTextInputValue('reason');

      try {
        const user = await client.users.fetch(userId);
        await addToBlacklist(userId, reason, interaction.user.id);

        await interaction.reply({ 
          content: `✅ Usuário ${user.username} (${userId}) foi adicionado à blacklist de recrutamento!\n**Motivo:** ${reason}`, 
         flags: 1 << 6 
        });
      } catch (error) {
        await interaction.reply({ 
          content: '❌ Erro ao adicionar usuário à blacklist. Verifique se o ID está correto.', 
         flags: 1 << 6 
        });
      }
    }

    if (interaction.customId === 'admin_remove_blacklist_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');

      const isBlacklisted = await isUserBlacklisted(userId);
      if (!isBlacklisted) {
        return interaction.reply({ 
          content: '❌ Este usuário não está na blacklist de recrutamento.', 
         flags: 1 << 6 
        });
      }

      try {
        const user = await client.users.fetch(userId);
        await removeFromBlacklist(userId);

        await interaction.reply({ 
          content: `✅ Usuário ${user.username} (${userId}) foi removido da blacklist de recrutamento!`, 
         flags: 1 << 6 
        });
      } catch (error) {
        await interaction.reply({ 
          content: '❌ Erro ao remover usuário da blacklist. Verifique se o ID está correto.', 
         flags: 1 << 6 
        });
      }
    }

    if (interaction.customId === 'admin_block_user_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');
      const reason = interaction.fields.getTextInputValue('reason') || 'Não especificado';

      try {
        const user = await client.users.fetch(userId);
        blockedVerificationUsers.add(userId);

        await interaction.reply({ 
          content: `✅ Usuário ${user.username} (${userId}) foi bloqueado de usar verificação!\n**Motivo:** ${reason}`, 
         flags: 1 << 6 
        });
      } catch (error) {
        await interaction.reply({ 
          content: '❌ Erro ao encontrar o usuário. Verifique se o ID está correto.', 
         flags: 1 << 6 
        });
      }
    }

    if (interaction.customId === 'admin_unblock_user_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');

      if (!blockedVerificationUsers.has(userId)) {
        return interaction.reply({ 
          content: '❌ Este usuário não está bloqueado.', 
         flags: 1 << 6 
        });
      }

      try {
        const user = await client.users.fetch(userId);
        blockedVerificationUsers.delete(userId);

        await interaction.reply({ 
          content: `✅ Usuário ${user.username} (${userId}) foi desbloqueado e pode usar verificação novamente!`, 
         flags: 1 << 6 
        });
      } catch (error) {
        await interaction.reply({ 
          content: '❌ Erro ao encontrar o usuário. Verifique se o ID está correto.', 
         flags: 1 << 6 
        });
      }
    }

    // Handler para modais do painel administrativo
    if (interaction.customId === 'admin_delete_post_modal') {
      const messageId = interaction.fields.getTextInputValue('message_id');

      try {
        const message = await interaction.channel.messages.fetch(messageId);
        await message.delete();

        // Limpar dados do post se existir
        for (const [postId, authorId] of postAuthors.entries()) {
          if (message.author.id === authorId) {
            postLikes.delete(postId);
            postComments.delete(postId);
            postAuthors.delete(postId);
            postPrivacySettings.delete(postId);
            userCommentCount.delete(postId);
            break;
          }
        }

        await interaction.reply({ content: '✅ Postagem deletada com sucesso!',flags: 1 << 6 });
      } catch (error) {
        await interaction.reply({ content: '❌ Erro ao deletar postagem. Verifique se o ID da mensagem está correto.',flags: 1 << 6 });
      }
    }

    if (interaction.customId === 'admin_delete_comment_modal') {
      const postId = interaction.fields.getTextInputValue('post_id');
      const commentNumber = parseInt(interaction.fields.getTextInputValue('comment_number'));

      if (!postComments.has(postId)) {
        return interaction.reply({ content: '❌ Post não encontrado. Verifique se o ID da postagem está correto.',flags: 1 << 6 });
      }

      const comments = postComments.get(postId);

      if (commentNumber < 1 || commentNumber > comments.length) {
        return interaction.reply({ content: '❌ Número de comentário inválido.',flags: 1 << 6 });
      }

      // Substituir o comentário por mensagem de restrição
      comments[commentNumber - 1] = {
        userId: 'admin',
        comment: '**comentário restrito pela administração**',
        timestamp: Date.now()
      };

      await interaction.reply({ content: '✅ Comentário restrito com sucesso!',flags: 1 << 6 });
    }

    if (interaction.customId === 'admin_remove_verified_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');

      try {
        const member = await interaction.guild.members.fetch(userId);
        const verifiedRoleId = '1392229571599929465';

        if (member.roles.cache.has(verifiedRoleId)) {
          await member.roles.remove(verifiedRoleId);
          await interaction.reply({ content: `✅ Cargo de verificado removido de ${member.user.username}!`,flags: 1 << 6 });
        } else {
          await interaction.reply({ content: '❌ Este usuário não possui o cargo de verificado.',flags: 1 << 6 });
        }
      } catch (error) {
        await interaction.reply({ content: '❌ Erro ao encontrar o usuário. Verifique se o ID está correto.',flags: 1 << 6 });
      }
    }

    // Handlers para sistema de hierarquia
    if (interaction.customId === 'admin_upar_usuario_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');

      try {
        const member = await interaction.guild.members.fetch(userId);

        // Hierarquia de cargos (do mais baixo ao mais alto)
        const hierarchy = [
          '1065441761171869796', // Iniciante (mais baixo)
          '1065441760177827930', // Celestial
          '1065441759171186688', // Místico
          '1065441757560574023', // Master
          '1065441756092571729', // Divindade
          '1065441754855260200'  // Lendário (mais alto)
        ];

        const roleNames = [
          'Iniciante',
          'Celestial', 
          'Místico',
          'Master',
          'Divindade',
          'Lendário'
        ];

        // Encontrar cargo atual do usuário
        let currentRoleIndex = -1;
        for (let i = 0; i < hierarchy.length; i++) {
          if (member.roles.cache.has(hierarchy[i])) {
            currentRoleIndex = i;
            break;
          }
        }

        if (currentRoleIndex === -1) {
          return interaction.reply({ 
            content: '❌ Este usuário não possui nenhum cargo da hierarquia de makers.', 
           flags: 1 << 6 
          });
        }

        if (currentRoleIndex === hierarchy.length - 1) {
          return interaction.reply({ 
            content: '❌ Este usuário já está no cargo mais alto (Lendário).', 
           flags: 1 << 6 
          });
        }

        // Remover cargo atual e adicionar próximo
        const currentRole = hierarchy[currentRoleIndex];
        const nextRole = hierarchy[currentRoleIndex + 1];

        await member.roles.remove(currentRole);
        await member.roles.add(nextRole);

        await interaction.reply({ 
          content: `✅ ${member.user.username} foi upado de **${roleNames[currentRoleIndex]}** para **${roleNames[currentRoleIndex + 1]}**!`, 
         flags: 1 << 6 
        });

      } catch (error) {
        await interaction.reply({ 
          content: '❌ Erro ao encontrar o usuário. Verifique se o ID está correto.', 
         flags: 1 << 6 
        });
      }
    }

    if (interaction.customId === 'admin_rebaixar_usuario_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');

      try {
        const member = await interaction.guild.members.fetch(userId);

        // Hierarquia de cargos (do mais baixo ao mais alto)
        const hierarchy = [
          '1065441761171869796', // Iniciante (mais baixo)
          '1065441760177827930', // Celestial
          '1065441759171186688', // Místico
          '1065441757560574023', // Master
          '1065441756092571729', // Divindade
          '1065441754855260200'  // Lendário (mais alto)
        ];

        const roleNames = [
          'Iniciante',
          'Celestial', 
          'Místico',
          'Master',
          'Divindade',
          'Lendário'
        ];

        // Verificar se tem o cargo especial mencionado
        const specialRole = '1224755216038236232';
        if (!member.roles.cache.has(specialRole)) {
          return interaction.reply({ 
            content: '❌ Este usuário não possui o cargo necessário para ser rebaixado.', 
           flags: 1 << 6 
          });
        }

        // Encontrar cargo atual do usuário
        let currentRoleIndex = -1;
        for (let i = 0; i < hierarchy.length; i++) {
          if (member.roles.cache.has(hierarchy[i])) {
            currentRoleIndex = i;
            break;
          }
        }

        if (currentRoleIndex === -1) {
          return interaction.reply({ 
            content: '❌ Este usuário não possui nenhum cargo da hierarquia de makers.', 
           flags: 1 << 6 
          });
        }

        if (currentRoleIndex === 0) {
          return interaction.reply({ 
            content: '❌ Este usuário já está no cargo mais baixo (Iniciante).', 
           flags: 1 << 6 
          });
        }

        // Remover cargo atual e adicionar anterior
        const currentRole = hierarchy[currentRoleIndex];
        const previousRole = hierarchy[currentRoleIndex - 1];

        await member.roles.remove(currentRole);
        await member.roles.add(previousRole);

        await interaction.reply({ 
          content: `✅ ${member.user.username} foi rebaixado de **${roleNames[currentRoleIndex]}** para **${roleNames[currentRoleIndex - 1]}**!`, 
         flags: 1 << 6 
        });

      } catch (error) {
        await interaction.reply({ 
          content: '❌ Erro ao encontrar o usuário. Verifique se o ID está correto.', 
         flags: 1 << 6 
        });
      }
    }

    if (interaction.customId === 'admin_remover_usuario_modal') {
      const userId = interaction.fields.getTextInputValue('user_id');

      try {
        const member = await interaction.guild.members.fetch(userId);

        // Todos os cargos que devem ser removidos
        const rolesToRemove = [
          '1072027317297229875', // Postador
          '1065441764460199967', // Cargo de maker base
          '1224755216038236232', // Cargo especial
          '1065441761171869796', // Iniciante
          '1065441760177827930', // Celestial
          '1065441759171186688', // Místico
          '1065441757560574023', // Master
          '1065441756092571729', // Divindade
          '1065441754855260200'  // Lendário
        ];

        // Verificar quais cargos o usuário possui
        const userRoles = member.roles.cache;
        const rolesToActuallyRemove = rolesToRemove.filter(roleId => userRoles.has(roleId));

        if (rolesToActuallyRemove.length === 0) {
          return interaction.reply({ 
            content: '❌ Este usuário não possui nenhum dos cargos de maker para ser removido.', 
           flags: 1 << 6 
          });
        }

        // Remover todos os cargos
        await member.roles.remove(rolesToActuallyRemove);

        await interaction.reply({ 
          content: `✅ Todos os cargos de maker foram removidos de ${member.user.username}! (${rolesToActuallyRemove.length} cargos removidos)`, 
         flags: 1 << 6 
        });

      } catch (error) {
        await interaction.reply({ 
          content: '❌ Erro ao encontrar o usuário. Verifique se o ID está correto.', 
         flags: 1 << 6 
        });
      }
    }

    if (interaction.customId === 'staff_individual_modal') {
      const staffId = interaction.fields.getTextInputValue('staff_id');

      try {
        const staffStats = await getStaffIndividualStats(staffId);

        if (!staffStats) {
          return interaction.reply({
            content: '❌ Nenhuma estatística encontrada para este staff. Verifique se o ID está correto ou se o staff já recebeu feedbacks.',
           flags: 1 << 6
          });
        }

        const staffUser = await client.users.fetch(staffId);
        const rating = staffStats.avg_rating.toFixed(1);
        const stars = '⭐'.repeat(Math.round(staffStats.avg_rating));

        // Buscar feedbacks detalhados por tipo de thread
        const detailedStats = await pgClient.query(`
          SELECT 
            thread_type,
            COUNT(*) as count,
            AVG(CASE 
              WHEN rating LIKE '%Excelente%' THEN 5
              WHEN rating LIKE '%Bom%' THEN 4
              WHEN rating LIKE '%Regular%' THEN 3
              WHEN rating LIKE '%Ruim%' THEN 2
              ELSE 3
            END) as avg_rating
          FROM staff_feedback 
          WHERE staff_id = $1
          GROUP BY thread_type
          ORDER BY count DESC
        `, [staffId]);

        let detailText = '';
        if (detailedStats.rows.length > 0) {
          detailText = '\n### 📋 **DETALHAMENTO POR ÁREA:**\n';
          for (const detail of detailedStats.rows) {
            const areaStars = '⭐'.repeat(Math.round(detail.avg_rating));
            detailText += `**${detail.thread_type}:** ${areaStars} (${detail.avg_rating.toFixed(1)}/5.0) - ${detail.count} feedbacks\n`;
          }
        }

        const individualEmbed = new EmbedBuilder()
          .setTitle(`📊 DESEMPENHO - ${staffUser.username}`)
          .setDescription(`
## 🏆 **ESTATÍSTICAS GERAIS:**

**Avaliação Média:** ${stars} **${rating}/5.0**
**Total de Feedbacks:** ${staffStats.total_feedbacks}
**Feedbacks Automáticos:** ${staffStats.automatic_count}

### 📈 **DISTRIBUIÇÃO DE NOTAS:**
⭐ **Excelente:** ${staffStats.excelente_count} (${(staffStats.excelente_count/staffStats.total_feedbacks*100).toFixed(1)}%)
👍 **Bom:** ${staffStats.bom_count} (${(staffStats.bom_count/staffStats.total_feedbacks*100).toFixed(1)}%)
👌 **Regular:** ${staffStats.regular_count} (${(staffStats.regular_count/staffStats.total_feedbacks*100).toFixed(1)}%)
👎 **Ruim:** ${staffStats.ruim_count} (${(staffStats.ruim_count/staffStats.total_feedbacks*100).toFixed(1)}%)

${detailText}

### 💡 **OBSERVAÇÕES:**
- Feedbacks automáticos são dados quando o usuário não responde em 5 minutos
- A média é calculada baseada nos valores: Excelente=5, Bom=4, Regular=3, Ruim=2
`)
          .setColor('#4CAF50')
          .setThumbnail(staffUser.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        await interaction.reply({ embeds: [individualEmbed],flags: 1 << 6 });

      } catch (error) {
        console.error('Erro ao buscar staff individual:', error);
        await interaction.reply({
          content: '❌ Erro ao buscar estatísticas. Verifique se o ID do staff está correto.',
         flags: 1 << 6
        });
      }
    }

    if (interaction.customId.startsWith('rejeitar_motivo_')) {
      const solicitacaoId = interaction.customId.replace('rejeitar_motivo_', '');
      const motivoRejeicao = interaction.fields.getTextInputValue('motivo_rejeicao');

      if (!global.banSolicitations || !global.banSolicitations.has(solicitacaoId)) {
        return interaction.reply({
          content: '❌ Solicitação não encontrada.',
          flags: 1 << 6
        });
      }

      const solicitacao = global.banSolicitations.get(solicitacaoId);

      try {
        // Atualizar embed de análise
        const rejectedEmbed = new EmbedBuilder()
          .setTitle('❌ **BANIMENTO REJEITADO**')
          .setDescription(`
**Usuário:** ${solicitacao.targetUserTag} (${solicitacao.targetUserId})
**Solicitado por:** ${solicitacao.requesterTag}
**Rejeitado por:** ${interaction.user}

**Motivo original:**
\`\`\`
${solicitacao.motivo}
\`\`\`

**Motivo da rejeição:**
\`\`\`
${motivoRejeicao}
\`\`\`

**Status:** ❌ Solicitação rejeitada
**Data de rejeição:** ${new Date().toLocaleString('pt-BR')}
`)
          .setColor('#ff4444')
          .setFooter({ text: `Solicitação: ${solicitacaoId}` })
          .setTimestamp();

        await interaction.update({ embeds: [rejectedEmbed], components: [] });

        // Buscar e atualizar a mensagem original de solicitação
        try {
          const originalChannel = client.channels.cache.get(solicitacao.channelId);
          if (originalChannel) {
            const messages = await originalChannel.messages.fetch({ limit: 50 });
            const originalMessage = messages.find(msg => 
              msg.embeds.length > 0 && 
              msg.embeds[0].title?.includes('SOLICITAÇÃO ENVIADA')
            );

            if (originalMessage) {
              const rejectedOriginalEmbed = new EmbedBuilder()
                .setTitle('❌ **SOLICITAÇÃO REJEITADA**')
                .setDescription(`
**Sua solicitação foi rejeitada pela administração.**

**Usuário relatado:** ${solicitacao.targetUserTag}
**Motivo original:** ${solicitacao.motivo}
**Rejeitado por:** ${interaction.user}

**Motivo da rejeição:**
\`\`\`
${motivoRejeicao}
\`\`\`

**Data de rejeição:** ${new Date().toLocaleString('pt-BR')}

> ❌ *A solicitação não foi aprovada conforme os critérios da administração.*
`)
                .setColor('#ff4444')
                .setTimestamp();

              await originalMessage.edit({ embeds: [rejectedOriginalEmbed], components: [] });
            }
          }
        } catch (updateError) {
          console.error('Erro ao atualizar mensagem original:', updateError);
        }

        // Atualizar status da solicitação
        solicitacao.status = 'rejeitado';
        solicitacao.rejectedBy = interaction.user.id;
        solicitacao.rejectionReason = motivoRejeicao;
        global.banSolicitations.set(solicitacaoId, solicitacao);

      } catch (error) {
        console.error('Erro ao processar rejeição:', error);
        await interaction.reply({
          content: '❌ Erro ao processar rejeição.',
          flags: 1 << 6
        });
      }
    }

    if (interaction.customId === 'youtube_modal') {
      const youtubeUrl = interaction.fields.getTextInputValue('youtube_url');
      const startTime = interaction.fields.getTextInputValue('start_time') || '0';
      const duration = interaction.fields.getTextInputValue('duration') || '5';

      if (!youtubeUrl) {
        return interaction.reply({
          content: '❌ Por favor, forneça um link válido do YouTube.',
         flags: 1 << 6
        });
      }

      const loadingEmbed = new EmbedBuilder()
        .setTitle('🎬 **PROCESSANDO YOUTUBE → GIF**')
        .setDescription(`
\`\`\`yaml
📺 URL: ${youtubeUrl}
⏱️ Início: ${startTime}s
⏳ Duração: ${duration}s
📊 Status: Baixando vídeo...
\`\`\`

> 🚀 *Aguarde enquanto convertemos seu vídeo para GIF!*
`)
        .setColor('#ff0000')

      await interaction.reply({ embeds: [loadingEmbed], ephemeral: false });

      try {
        const gifBuffer = await convertYouTubeToGif(youtubeUrl, parseInt(startTime), parseInt(duration));
        const attachment = new AttachmentBuilder(gifBuffer, { name: `youtube_${Date.now()}.gif` });

        const resultEmbed = new EmbedBuilder()
          .setTitle(' **YOUTUBE → GIF CONCLUÍDO!**')
          .setDescription(`
📺 Seu vídeo do YouTube foi convertido com sucesso!

\`\`\`yaml
 Origem: YouTube
🎞 Formato: GIF Animado
 Duração: ${duration}s
 Tamanho: ${(gifBuffer.length / 1024 / 1024).toFixed(2)} MB
\`\`\`

>  *Qualidade preservada!*
`)
          .setColor('#00ff88')
          .setTimestamp();

        await interaction.editReply({ embeds: [resultEmbed], files: [attachment] });

      } catch (error) {
        console.error('Erro YouTube:', error);
        await interaction.editReply({
          content: '❌ Erro ao processar vídeo do YouTube. Verifique se o link está correto.',
          embeds: []
        });
      }
    }

    if (interaction.customId === 'resize_gif_modal') {
      const percentage = interaction.fields.getTextInputValue('percentage');

      // Validar porcentagem
      const percentageNum = parseInt(percentage);
      if (isNaN(percentageNum) || percentageNum < 1 || percentageNum > 100) {
        return interaction.reply({
          content: '❌ Por favor, insira uma porcentagem válida entre 1 e 100.',
         flags: 1 << 6
        });
      }

      // Definir escolha com porcentagem
      conversaoEscolha.set(interaction.channel.id, { type: 'resize-gif', percentage: percentageNum });

      const embed = new EmbedBuilder()
        .setTitle(' **OPÇÃO SELECIONADA**')
        .setDescription(`**Redimensionar GIF** selecionado!\n> **Otimização:** ${percentageNum}% de redução\n> Envie seu arquivo GIF para otimização`)
        .setColor('#8804fc')
        .setFooter({ text: 'Dica: Você pode arrastar e soltar o arquivo diretamente no chat!' });

      await interaction.reply({ embeds: [embed], ephemeral: false });
    }

    if (interaction.customId === 'stretch_image_modal') {
      const width = parseInt(interaction.fields.getTextInputValue('width'));
      const height = parseInt(interaction.fields.getTextInputValue('height'));
      const mode = interaction.fields.getTextInputValue('mode') || 'stretch';

      if (isNaN(width) || isNaN(height) || width < 1 || height < 1) {
        return interaction.reply({
          content: '❌ Por favor, insira dimensões válidas (números positivos).',
         flags: 1 << 6
        });
      }

      conversaoEscolha.set(interaction.channel.id, { 
        type: 'stretch-image', 
        width: width, 
        height: height, 
        mode: mode 
      });

      const embed = new EmbedBuilder()
        .setTitle(' **OPÇÃO SELECIONADA**')
        .setDescription(`**Esticar Imagem** selecionado!\n> **Dimensões:** ${width}x${height}px\n> **Modo:** ${mode}\n> Envie sua imagem para redimensionar`)
        .setColor('#8804fc')
        .setFooter({ text: 'Dica: Você pode arrastar e soltar o arquivo diretamente no chat!' });

      await interaction.reply({ embeds: [embed], ephemeral: false });
    }

    if (interaction.customId === 'format_convert_modal') {
      const targetFormat = interaction.fields.getTextInputValue('target_format').toLowerCase();
      const quality = parseInt(interaction.fields.getTextInputValue('quality')) || 90;

      const validFormats = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'];
      if (!validFormats.includes(targetFormat)) {
        return interaction.reply({
          content: '❌ Formato inválido. Use: png, jpg, webp, gif, bmp ou tiff.',
         flags: 1 << 6
        });
      }

      conversaoEscolha.set(interaction.channel.id, { 
        type: 'format-convert', 
        format: targetFormat,
        quality: quality
      });

      const embed = new EmbedBuilder()
        .setTitle(' **OPÇÃO SELECIONADA**')
        .setDescription(`**Converter Formato** selecionado!\n> **Para:** ${targetFormat.toUpperCase()}\n> **Qualidade:** ${quality}%\n> Envie seu arquivo para converter`)
        .setColor('#8804fc')
        .setFooter({ text: 'Dica: Você pode arrastar e soltar o arquivo diretamente no chat!' });

      await interaction.reply({ embeds: [embed], ephemeral: false });
    }

    if (interaction.customId === 'rename_files_modal') {
      const pattern = interaction.fields.getTextInputValue('pattern');
      const startNumber = parseInt(interaction.fields.getTextInputValue('start_number')) || 1;

      conversaoEscolha.set(interaction.channel.id, { 
        type: 'rename-files', 
        pattern: pattern,
        startNumber: startNumber
      });

      const embed = new EmbedBuilder()
        .setTitle(' **OPÇÃO SELECIONADA**')
        .setDescription(`**Renomear Arquivos** selecionado!\n> **Padrão:** ${pattern}\n> **Início:** ${startNumber}\n> Envie seus arquivos para renomear`)
        .setColor('#8804fc')
        .setFooter({ text: 'Dica: Você pode enviar múltiplos arquivos!' });

      await interaction.reply({ embeds: [embed], ephemeral: false });
    }

    if (interaction.customId === 'tiktok_download_modal') {
      const tiktokUrl = interaction.fields.getTextInputValue('tiktok_url');

      if (!tiktokUrl) {
        return interaction.reply({
          content: '❌ Por favor, forneça um link válido do TikTok.',
         flags: 1 << 6
        });
      }

      const loadingEmbed = new EmbedBuilder()
        .setTitle('📱 **BAIXANDO VÍDEO DO TIKTOK**')
        .setDescription(`
\`\`\`yaml
 URL: ${tiktokUrl}
 Status: Processando...
 Aguarde: Baixando vídeo...
\`\`\`

>  *Aguarde enquanto baixamos seu vídeo do TikTok!*
`)
        .setColor('#fe2c55')
        .setTimestamp();

      await interaction.reply({ embeds: [loadingEmbed], ephemeral: false });

      try {
        const result = await downloadTikTokVideoRapidAPI(tiktokUrl);
        const attachment = new AttachmentBuilder(result.buffer, { name: result.name });

        const fileSize = (result.buffer.length / 1024 / 1024).toFixed(2);

        const resultEmbed = new EmbedBuilder()
          .setTitle(' **TIKTOK BAIXADO COM SUCESSO!**')
          .setDescription(`
📱 Seu vídeo do TikTok foi baixado com sucesso!

\`\`\`yaml
 Arquivo: ${result.name}
 Tamanho: ${fileSize} MB
 Formato: MP4
 Plataforma: TikTok
 Qualidade: HD
\`\`\`

>  *Download concluído com sucesso!*
`)
          .setColor('#00ff88')
          .setFooter({ text: `Baixado para ${interaction.user.username}` })
          .setTimestamp();

        await interaction.editReply({
          content: `${interaction.user}`,
          embeds: [resultEmbed],
          files: [attachment]
        });

      } catch (error) {
        console.error('Erro TikTok:', error);
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ **ERRO NO DOWNLOAD**')
          .setDescription(`
\`\`\`yaml
 Falha no download
 URL: ${tiktokUrl}
 Erro: ${error.message || 'Erro desconhecido'}
\`\`\`

>  *Verifique se o link está correto e tente novamente*
`)
          .setColor('#ff4444')
          .setTimestamp();

        await interaction.editReply({
          embeds: [errorEmbed]
        });
      }
    }

    if (interaction.customId === 'video_download_modal') {
      const tiktokUrl = interaction.fields.getTextInputValue('tiktok_url');
      const instagramUrl = interaction.fields.getTextInputValue('instagram_url');

      if (!tiktokUrl && !instagramUrl) {
        return interaction.reply({
          content: 'Por favor, preencha pelo menos um dos campos com um link válido.',
         flags: 1 << 6
        });
      }

      await interaction.reply({
        content: 'Aguarde... Baixando o vídeo...',
        ephemeral: false
      });

      try {
        let videoBuffer, videoName;

        if (tiktokUrl) {
          const result = await downloadTikTokVideo(tiktokUrl);
          videoBuffer = result.buffer;
          videoName = result.name;
        } else if (instagramUrl) {
          const result = await downloadInstagramVideo(instagramUrl);
          videoBuffer = result.buffer;
          videoName = result.name;
        }

        const fileSize = (videoBuffer.length / 1024 / 1024).toFixed(2);
        const attachment = new AttachmentBuilder(videoBuffer, { name: videoName });

        const resultEmbed = new EmbedBuilder()
          .setTitle(' Vídeo Baixado com Sucesso!')
          .setColor('#00ff00')
          .addFields(
            { name: ' Tamanho', value: `${fileSize} MB`, inline: true },
            { name: ' Plataforma', value: tiktokUrl ? 'TikTok' : 'Instagram', inline: true },
            { name: ' Formato', value: 'MP4', inline: true }
          )
          .setFooter({ text: `Baixado para ${interaction.user.username}` })
          .setTimestamp();

        await interaction.editReply({
          content: `${interaction.user}`,
          embeds: [resultEmbed],
          files: [attachment]
        });

      } catch (error) {
        console.error('Erro ao baixar vídeo:', error);
        await interaction.editReply({
          content: 'Erro ao baixar o vídeo. Verifique se o link está correto e tente novamente.'
        });
      }
    }
    return;
  }

  // Handler para Select Menu de conversão
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'conversion_select') {
      const selectedOption = interaction.values[0];

      // Handler específico para download TikTok
      if (selectedOption === 'download_tiktok') {
        const modal = new ModalBuilder()
          .setCustomId('tiktok_download_modal')
          .setTitle('📱 Download TikTok');

        const tiktokInput = new TextInputBuilder()
          .setCustomId('tiktok_url')
          .setLabel('Link do TikTok')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://www.tiktok.com/@user/video/...')
          .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(tiktokInput);
        modal.addComponents(row1);

        await interaction.showModal(modal);
        return;
      }

      // Mapear para os outros handlers existentes
      const optionMap = {
        'video_to_gif': 'video_to_gif',
        'resize_gif': 'resize_gif', 
        'crop_image': 'crop_image',
        'stretch_image': 'stretch_image',
        'discord_banner': 'discord_banner',
        'format_convert': 'format_convert',
        'rename_files': 'rename_files',
        'separate_resolution': 'separate_resolution',
        'color_extractor': 'color_extractor',
        'youtube_to_gif': 'youtube_to_gif'
      };

      // Processar diretamente com a interação original
      const selectedType = optionMap[selectedOption];

      if (selectedType) {
        await handleConversionOption(interaction, selectedType);
      }
    }

    // Handler para Select Menu de cores booster
    if (interaction.customId === 'booster_color_category') {
      const selectedCategory = interaction.values[0];

      let categoryEmbed;
      let colorButtons;

      if (selectedCategory === 'pasteis') {
        categoryEmbed = new EmbedBuilder()
          .setTitle(' CORES PASTÉIS')
          .setDescription(`
Selecione uma das cores pastéis abaixo:

<:p_brush:1398758670761988157> - <@&1298119975453593600>
<:p_brush1:1398758933182550067> - <@&1298119805936734248>
<:p_brush2:1398759046445535393> - <@&1298120196908912660>
<:p_brush3:1398759435345858561> - <@&1298120108719345674>
<:p_brush4:1398759757027999744> - <@&1298120431605121024>

Clique no botão correspondente à cor desejada para aplicá-la ao seu nick!
`)
          .setColor('#FFB6C1')
          .setTimestamp();

        colorButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('booster_pastel_1')
            .setEmoji('<:p_brush:1398758670761988157>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_pastel_2')
            .setEmoji('<:p_brush1:1398758933182550067>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_pastel_3')
            .setEmoji('<:p_brush2:1398759046445535393>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_pastel_4')
            .setEmoji('<:p_brush3:1398759435345858561>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_pastel_5')
            .setEmoji('<:p_brush4:1398759757027999744>')
            .setStyle(ButtonStyle.Secondary)
        );
      } else if (selectedCategory === 'neon') {
        categoryEmbed = new EmbedBuilder()
          .setTitle(' CORES NEON')
          .setDescription(`
Selecione uma das cores neon abaixo:

<:n_brush:1398759884815863950> - <@&1398736295278153901>
<:n_brush1:1398759976343961712> - <@&1398736303926804530>
<:n_brush2:1398760077686472815> - <@&1398736311032090706>

Clique no botão correspondente à cor desejada para aplicá-la ao seu nick!
`)
          .setColor('#00FF00')
          .setTimestamp();

        colorButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('booster_neon_1')
            .setEmoji('<:n_brush:1398759884815863950>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_neon_2')
            .setEmoji('<:n_brush1:1398759976343961712>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_neon_3')
            .setEmoji('<:n_brush2:1398760077686472815>')
            .setStyle(ButtonStyle.Secondary)
        );
      } else if (selectedCategory === 'metalicas') {
        categoryEmbed = new EmbedBuilder()
          .setTitle(' CORES METÁLICAS')
          .setDescription(`
Selecione uma das cores metálicas abaixo:

<:m_brush:1398760429248970753> - <@&1398736652163219557>
<:m_brush1:1398760537738969198> - <@&1398736647537033318>
<:m_brush2:1398760653413679167> - <@&1398736657041068042>

Clique no botão correspondente à cor desejada para aplicá-la ao seu nick!
`)
          .setColor('#C0C0C0')
          .setTimestamp();

        colorButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('booster_metalica_1')
            .setEmoji('<:m_brush:1398760429248970753>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_metalica_2')
            .setEmoji('<:m_brush1:1398760537738969198>')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('booster_metalica_3')
            .setEmoji('<:m_brush2:1398760653413679167>')
            .setStyle(ButtonStyle.Secondary)
        );
      }

      await interaction.reply({ 
        embeds: [categoryEmbed], 
        components: [colorButtons], 
       flags: 1 << 6 
      });
    }
    return;
  }

  if (!interaction.isButton()) return;

  // Verificar se a interação ainda é válida
  if (interaction.replied || interaction.deferred) {
    console.log('Interação de botão já foi processada, ignorando');
    return;
  }

  // Verificar se a interação não expirou (mais de 2.5 segundos)
  const buttonInteractionAge = Date.now() - interaction.createdTimestamp;
  if (buttonInteractionAge > 2500) {
    console.log(`Interação de botão expirada (${buttonInteractionAge}ms), ignorando`);
    return;
  }

  const { customId, user, channel } = interaction;

  if (customId === 'abrir_conversor') {
    const starterMessage = await channel.send({
      content: '‎', 
      allowedMentions: { users: [] }
    });

    const thread = await starterMessage.startThread({
      name: `🎞️ | Conversão - ${user.username}`,
      autoArchiveDuration: 60,
      type: 12, // GUILD_PRIVATE_THREAD - torna a thread privada
      reason: 'Conversão de arquivos'
    });

    starterMessage.delete().catch(() => {});
    const embed = new EmbedBuilder()
      .setTitle('🎬 **CONVERSÃO GIFZADA**')
      .setDescription(`
╭──────────────────────────────────╮
│   Bem-vindo, **${user.username}**!  │
╰──────────────────────────────────╯

<:d_emoji_273:1366581300500365343> **INSTRUÇÕES SIMPLES:**

\`\`\`diff
+ 1. Escolha o tipo de conversão desejada
+ 2. Envie seu arquivo (arraste e solte)
+ 3. Aguarde o processamento automático
+ 4. Receba o resultado otimizado!
\`\`\`

## <:d_arrow:1366582051507273728> **OPÇÕES DISPONÍVEIS:**

### <:d_arrow:1366582051507273728> **Vídeo → GIF**
\`•\` Converte vídeos em GIFs de alta qualidade
\`•\` Otimização automática de tamanho e FPS
\`•\` Formatos: MP4, AVI, MOV, WMV, MKV

### <:d_arrow:1366582051507273728> **Redimensionar GIF**  
\`•\` Reduz tamanho mantendo qualidade visual
\`•\` Algoritmo inteligente de compressão
\`•\` Ideal para Discord e redes sociais

### <:d_arrow:1366582051507273728> **Cortar Imagem/GIF**
\`•\` Recorte automático em proporção 1:1
\`•\` Detecção da melhor área de corte
\`•\` Suporte a imagens e GIFs animados

### <:d_arrow:1366582051507273728> **Esticar Imagem**
\`•\` Redimensiona imagem para resolução específica
\`•\` Estica proporcionalmente ou forçado
\`•\` Ideal para banners e wallpapers

### <:d_arrow:1366582051507273728> **Banner Discord**
\`•\` Corta GIF/imagem para 734x293px
\`•\` Formato perfeito para banner do Discord
\`•\` Preserva qualidade e movimento

### <:d_arrow:1366582051507273728> **Conversões de Formato**
\`•\` WEBP → PNG, JPG → PNG, etc
\`•\` Múltiplos formatos suportados
\`•\` Preservação da qualidade

### <:d_arrow:1366582051507273728> **Renomear Arquivos**
\`•\` Renomeia múltiplos arquivos em lote
\`•\` Padrões personalizados
\`•\` Numeração automática

### <:d_arrow:1366582051507273728> **Separar por Resolução**
\`•\` Separa PFP (1:1) e Banners
\`•\` Detecção automática
\`•\` Organização inteligente

### <:d_arrow:1366582051507273728> **Extrator de Cores**
\`•\` Extrai HEX, RGB, HSL
\`•\` Cores dominantes da imagem
\`•\` Paleta completa

### <:d_arrow:1366582051507273728> **YouTube → GIF**
\`•\` Cole o link do YouTube
\`•\` Conversão direta para GIF
\`•\` Qualidade HD preservada

<:d_arrow:1366582051507273728> TikTok → GIF
• Cole o link do TikTok
• Conversão direta para GIF
• Qualidade HD preservada
`)
      .setColor('#870CFF')
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setFooter({ 
        text: 'Tecnologia de conversão GIFZADA',
        iconURL: 'https://cdn.discordapp.com/icons/953748240589787136/a_85b194eaf3055cfc583d70b3b14cbaa5.gif?size=64'
      })
      .setTimestamp();

    const { StringSelectMenuBuilder } = require('discord.js');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('conversion_select')
      .setPlaceholder('🎯 Escolha o tipo de conversão desejada')
      .addOptions([
        {
          label: 'Vídeo para GIF',
          description: 'Converte vídeos em GIFs de alta qualidade',
          value: 'video_to_gif',
          emoji: '<:videotogif:1366159226891931688>'
        },
        {
          label: 'Redimensionar GIF',
          description: 'Reduz tamanho mantendo qualidade visual',
          value: 'resize_gif',
          emoji: '<:resize:1366160012774477824>'
        },
        {
          label: 'Cortar Imagem/GIF',
          description: 'Recorte automático em proporção 1:1',
          value: 'crop_image',
          emoji: '<:crop:1366160563872202892>'
        },
        {
          label: 'Esticar Imagem',
          description: 'Redimensiona para resolução específica',
          value: 'stretch_image',
          emoji: '📏'
        },
        {
          label: 'Banner Discord',
          description: 'Corta para formato 734x293px',
          value: 'discord_banner',
          emoji: '🖼️'
        },
        {
          label: 'Converter Formato',
          description: 'Converte entre diferentes formatos',
          value: 'format_convert',
          emoji: '🔄'
        },
        {
          label: 'Renomear Arquivos',
          description: 'Renomeia múltiplos arquivos em lote',
          value: 'rename_files',
          emoji: '📝'
        },
        {
          label: 'Separar por Resolução',
          description: 'Separa PFP (1:1) e Banners automaticamente',
          value: 'separate_resolution',
          emoji: '📐'
        },
        {
          label: 'Extrator de Cores',
          description: 'Extrai HEX, RGB e cores dominantes',
          value: 'color_extractor',
          emoji: '🎨'
        },
        {
          label: 'YouTube para GIF',
          description: 'Converte vídeos do YouTube diretamente',
          value: 'youtube_to_gif',
          emoji: '<:youtube:1386479955936022630>'
        },
        {
          label: 'Download TikTok',
          description: 'Baixa vídeos do TikTok em HD',
          value: 'download_tiktok',
          emoji: '<:tiktok:1386523276171280495>'
        }
      ]);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('encerrar_thread')
        .setLabel('Encerrar Thread')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    await thread.send({ content: `${user}`, embeds: [embed], components: [row1, row2] });

    // Iniciar timer de inatividade para a thread
    startInactivityTimer(thread.id, user.id);

    // Verificar se a interação ainda é válida antes de responder
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Thread criada com sucesso!',flags: 1 << 6 });
      } catch (error) {
        console.error('Erro ao responder interação:', error);
        // Se a interação expirou, tentar enviar uma mensagem normal
        if (error.code === 10062) {
          console.log('Interação expirou, thread criada com sucesso');
        }
      }
    }
  }

  // Função para processar opções de conversão
  async function handleConversionOption(interaction, customId) {
    // Verificar se channel existe
    if (!interaction.channel) {
      console.error('Canal não encontrado na interação:', interaction);
      return interaction.reply({
        content: '❌ Erro interno: canal não encontrado. Tente novamente.',
       flags: 1 << 6
      });
    }

    // Resetar timer de inatividade se for uma thread de conversor
    if (interaction.channel.isThread() && conversaoEscolha.has(interaction.channel.id)) {
      resetInactivityTimer(interaction.channel.id, interaction.user.id);
    }

    const tipos = {
      video_to_gif: 'video-to-gif',
      resize_gif: 'resize-gif',
      crop_image: 'crop-image',
      youtube_to_gif: 'youtube-to-gif',
      stretch_image: 'stretch-image',
      discord_banner: 'discord-banner',
      format_convert: 'format-convert',
      rename_files: 'rename-files',
      separate_resolution: 'separate-resolution',
      color_extractor: 'color-extractor'
    };

    if (tipos[customId]) {
      // Para YouTube, abrir modal diretamente
      if (customId === 'youtube_to_gif') {
        const modal = new ModalBuilder()
          .setCustomId('youtube_modal')
          .setTitle('YouTube para GIF');

        const youtubeInput = new TextInputBuilder()
          .setCustomId('youtube_url')
          .setLabel('Link do YouTube')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://www.youtube.com/watch?v=...')
          .setRequired(true);

        const startTimeInput = new TextInputBuilder()
          .setCustomId('start_time')
          .setLabel('Tempo inicial (opcional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 10 (para começar aos 10 segundos)')
          .setRequired(false);

        const durationInput = new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duração em segundos (máx: 10)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 5 (para GIF de 5 segundos)')
          .setRequired(false);

        const row1 = new ActionRowBuilder().addComponents(youtubeInput);
        const row2 = new ActionRowBuilder().addComponents(startTimeInput);
        const row3 = new ActionRowBuilder().addComponents(durationInput);

        modal.addComponents(row1, row2, row3);
        await interaction.showModal(modal);
        return;
      }

      // Para redimensionar GIF, abrir modal para porcentagem
      if (customId === 'resize_gif') {
        const modal = new ModalBuilder()
          .setCustomId('resize_gif_modal')
          .setTitle('🔄 Redimensionar GIF');

        const percentageInput = new TextInputBuilder()
          .setCustomId('percentage')
          .setLabel('Porcentagem de otimização (1-100%)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 50 (para reduzir 50% do tamanho)')
          .setMinLength(1)
          .setMaxLength(3)
          .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(percentageInput);
        modal.addComponents(row1);
        await interaction.showModal(modal);
        return;
      }

      // Para esticar imagem, abrir modal para dimensões
      if (customId === 'stretch_image') {
        const modal = new ModalBuilder()
          .setCustomId('stretch_image_modal')
          .setTitle('📏 Esticar Imagem');

        const widthInput = new TextInputBuilder()
          .setCustomId('width')
          .setLabel('Largura (pixels)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 1920')
          .setRequired(true);

        const heightInput = new TextInputBuilder()
          .setCustomId('height')
          .setLabel('Altura (pixels)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 1080')
          .setRequired(true);

        const modeInput = new TextInputBuilder()
          .setCustomId('mode')
          .setLabel('Modo (stretch/fit/fill)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('stretch - estica | fit - proporcional | fill - preenche')
          .setRequired(false);

        const row1 = new ActionRowBuilder().addComponents(widthInput);
        const row2 = new ActionRowBuilder().addComponents(heightInput);
        const row3 = new ActionRowBuilder().addComponents(modeInput);
        modal.addComponents(row1, row2, row3);
        await interaction.showModal(modal);
        return;
      }

      // Para converter formato, abrir modal
      if (customId === 'format_convert') {
        const modal = new ModalBuilder()
          .setCustomId('format_convert_modal')
          .setTitle('🔄 Converter Formato');

        const formatInput = new TextInputBuilder()
          .setCustomId('target_format')
          .setLabel('Formato de destino')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('png, jpg, webp, gif, bmp')
          .setRequired(true);

        const qualityInput = new TextInputBuilder()
          .setCustomId('quality')
          .setLabel('Qualidade (1-100, apenas para JPG)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 90 (opcional)')
          .setRequired(false);

        const row1 = new ActionRowBuilder().addComponents(formatInput);
        const row2 = new ActionRowBuilder().addComponents(qualityInput);
        modal.addComponents(row1, row2);
        await interaction.showModal(modal);
        return;
      }

      // Para renomear arquivos, abrir modal
      if (customId === 'rename_files') {
        const modal = new ModalBuilder()
          .setCustomId('rename_files_modal')
          .setTitle('📝 Renomear Arquivos');

        const patternInput = new TextInputBuilder()
          .setCustomId('pattern')
          .setLabel('Padrão do nome')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: arquivo_{numero} ou imagem_{data}')
          .setRequired(true);

        const startInput = new TextInputBuilder()
          .setCustomId('start_number')
          .setLabel('Número inicial (opcional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 1, 001, 100')
          .setRequired(false);

        const row1 = new ActionRowBuilder().addComponents(patternInput);
        const row2 = new ActionRowBuilder().addComponents(startInput);
        modal.addComponents(row1, row2);
        await interaction.showModal(modal);
        return;
      }



      // Para outros tipos, definir escolha e responder
      conversaoEscolha.set(interaction.channel.id, tipos[customId]);

      const responseMessages = {
        'video-to-gif': '**Conversão Vídeo → GIF** selecionada!\n> Envie seu arquivo de vídeo (.mp4, .avi, .mov, .wmv, .mkv)',
        'crop-image': '**Cortar Imagem** selecionado!\n> Envie sua imagem ou GIF para recorte 1:1',
        'discord-banner': '**Banner Discord** selecionado!\n> Envie sua imagem ou GIF para cortar em 734x293px',
        'separate-resolution': '**Separar por Resolução** selecionado!\n> Envie múltiplas imagens para separar por tipo (PFP/Banner)',
        'color-extractor': '**Extrator de Cores** selecionado!\n> Envie uma imagem para extrair HEX, RGB e cores dominantes'
      };

      const embed = new EmbedBuilder()
        .setTitle('✅ **OPÇÃO SELECIONADA**')
        .setDescription(responseMessages[tipos[customId]])
        .setColor('#8804fc')
        .setFooter({ text: 'Dica: Você pode arrastar e soltar o arquivo diretamente no chat!' });

      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ embeds: [embed], ephemeral: false });
        }
      } catch (error) {
        console.error('Erro ao responder interação:', error);
        if (error.code === 10062) {
          console.log('Interação expirou, mas embed foi enviado');
        }
      }
    }
  }

  const tipos = {
    video_to_gif: 'video-to-gif',
    resize_gif: 'resize-gif',
    crop_image: 'crop-image',
    youtube_to_gif: 'youtube-to-gif',
    stretch_image: 'stretch-image',
    discord_banner: 'discord-banner',
    format_convert: 'format-convert',
    rename_files: 'rename-files',
    separate_resolution: 'separate-resolution',
    color_extractor: 'color-extractor'
  };

  if (tipos[customId]) {
    // Para YouTube, abrir modal diretamente
    if (customId === 'youtube_to_gif') {
      const modal = new ModalBuilder()
        .setCustomId('youtube_modal')
        .setTitle('YouTube para GIF');

      const youtubeInput = new TextInputBuilder()
        .setCustomId('youtube_url')
        .setLabel('Link do YouTube')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://www.youtube.com/watch?v=...')
        .setRequired(true);

      const startTimeInput = new TextInputBuilder()
        .setCustomId('start_time')
        .setLabel('Tempo inicial (opcional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 10 (para começar aos 10 segundos)')
        .setRequired(false);

      const durationInput = new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Duração em segundos (máx: 10)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 5 (para GIF de 5 segundos)')
        .setRequired(false);

      const row1 = new ActionRowBuilder().addComponents(youtubeInput);
      const row2 = new ActionRowBuilder().addComponents(startTimeInput);
      const row3 = new ActionRowBuilder().addComponents(durationInput);

      modal.addComponents(row1, row2, row3);
      await interaction.showModal(modal);
      return;
    }

    // Para redimensionar GIF, abrir modal para porcentagem
    if (customId === 'resize_gif') {
      const modal = new ModalBuilder()
        .setCustomId('resize_gif_modal')
        .setTitle('🔄 Redimensionar GIF');

      const percentageInput = new TextInputBuilder()
        .setCustomId('percentage')
        .setLabel('Porcentagem de otimização (1-100%)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 50 (para reduzir 50% do tamanho)')
        .setMinLength(1)
        .setMaxLength(3)
        .setRequired(true);

      const row1 = new ActionRowBuilder().addComponents(percentageInput);
      modal.addComponents(row1);
      await interaction.showModal(modal);
      return;
    }

    // Para esticar imagem, abrir modal para dimensões
    if (customId === 'stretch_image') {
      const modal = new ModalBuilder()
        .setCustomId('stretch_image_modal')
        .setTitle('📏 Esticar Imagem');

      const widthInput = new TextInputBuilder()
        .setCustomId('width')
        .setLabel('Largura (pixels)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 1920')
        .setRequired(true);

      const heightInput = new TextInputBuilder()
        .setCustomId('height')
        .setLabel('Altura (pixels)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 1080')
        .setRequired(true);

      const modeInput = new TextInputBuilder()
        .setCustomId('mode')
        .setLabel('Modo (stretch/fit/fill)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('stretch - estica | fit - proporcional | fill - preenche')
        .setRequired(false);

      const row1 = new ActionRowBuilder().addComponents(widthInput);
      const row2 = new ActionRowBuilder().addComponents(heightInput);
      const row3 = new ActionRowBuilder().addComponents(modeInput);
      modal.addComponents(row1, row2, row3);
      await interaction.showModal(modal);
      return;
    }

    // Para converter formato, abrir modal
    if (customId === 'format_convert') {
      const modal = new ModalBuilder()
        .setCustomId('format_convert_modal')
        .setTitle('🔄 Converter Formato');

      const formatInput = new TextInputBuilder()
        .setCustomId('target_format')
        .setLabel('Formato de destino')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('png, jpg, webp, gif, bmp')
        .setRequired(true);

      const qualityInput = new TextInputBuilder()
        .setCustomId('quality')
        .setLabel('Qualidade (1-100, apenas para JPG)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 90 (opcional)')
        .setRequired(false);

      const row1 = new ActionRowBuilder().addComponents(formatInput);
      const row2 = new ActionRowBuilder().addComponents(qualityInput);
      modal.addComponents(row1, row2);
      await interaction.showModal(modal);
      return;
    }

    // Para renomear arquivos, abrir modal
    if (customId === 'rename_files') {
      const modal = new ModalBuilder()
        .setCustomId('rename_files_modal')
        .setTitle('📝 Renomear Arquivos');

      const patternInput = new TextInputBuilder()
        .setCustomId('pattern')
        .setLabel('Padrão do nome')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: arquivo_{numero} ou imagem_{data}')
        .setRequired(true);

      const startInput = new TextInputBuilder()
        .setCustomId('start_number')
        .setLabel('Número inicial (opcional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 1, 001, 100')
        .setRequired(false);

      const row1 = new ActionRowBuilder().addComponents(patternInput);
      const row2 = new ActionRowBuilder().addComponents(startInput);
      modal.addComponents(row1, row2);
      await interaction.showModal(modal);
      return;
    }

    // Para outros tipos, definir escolha e responder
    conversaoEscolha.set(interaction.channel.id, tipos[customId]);

    const responseMessages = {
      'video-to-gif': '**Conversão Vídeo → GIF** selecionada!\n> Envie seu arquivo de vídeo (.mp4, .avi, .mov, .wmv, .mkv)',
      'crop-image': '**Cortar Imagem** selecionado!\n> Envie sua imagem ou GIF para recorte 1:1',
      'discord-banner': '**Banner Discord** selecionado!\n> Envie sua imagem ou GIF para cortar em 734x293px',
      'separate-resolution': '**Separar por Resolução** selecionado!\n> Envie múltiplas imagens para separar por tipo (PFP/Banner)',
      'color-extractor': '**Extrator de Cores** selecionado!\n> Envie uma imagem para extrair HEX, RGB e cores dominantes'
    };

    const embed = new EmbedBuilder()
      .setTitle('✅ **OPÇÃO SELECIONADA**')
      .setDescription(responseMessages[tipos[customId]])
      .setColor('#8804fc')
      .setFooter({ text: 'Dica: Você pode arrastar e soltar o arquivo diretamente no chat!' });

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ embeds: [embed], ephemeral: false });
      }
    } catch (error) {
      console.error('Erro ao responder interação:', error);
      if (error.code === 10062) {
        console.log('Interação expirou, mas embed foi enviado');
      }
    }
  }



  // Handlers para botões de suporte
  if (customId === 'receba_ajuda') {
    const modal = new ModalBuilder()
      .setCustomId('ajuda_modal')
      .setTitle('Receba Ajuda - GIFZADA');

    const assuntoInput = new TextInputBuilder()
      .setCustomId('assunto')
      .setLabel('Assunto')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descricaoInput = new TextInputBuilder()
      .setCustomId('descricao')
      .setLabel('Descrição')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(assuntoInput);
    const row2 = new ActionRowBuilder().addComponents(descricaoInput);

    modal.addComponents(row1, row2);
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'denunciar_alguem') {
    const modal = new ModalBuilder()
      .setCustomId('denuncia_modal')
      .setTitle('Denunciar Alguém - GIFZADA');

    const assuntoInput = new TextInputBuilder()
      .setCustomId('assunto')
      .setLabel('Assunto')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descricaoInput = new TextInputBuilder()
      .setCustomId('descricao')
      .setLabel('Descrição')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(assuntoInput);
    const row2 = new ActionRowBuilder().addComponents(descricaoInput);

    modal.addComponents(row1, row2);
    await interaction.showModal(modal);
    return;
  }

  // Handlers para botões de recrutamento
  if (customId === 'f68019bd98e443d9bfbefbb1bb752d44') {
    const modal = new ModalBuilder()
      .setCustomId('seja_maker_modal')
      .setTitle('Seja Staff - GIFZADA');

    const nomeInput = new TextInputBuilder()
      .setCustomId('nome')
      .setLabel('Nome')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const idadeInput = new TextInputBuilder()
      .setCustomId('idade')
      .setLabel('Idade')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const foiMakerInput = new TextInputBuilder()
      .setCustomId('foi_maker')
      .setLabel('Já foi staff de outro servidor?')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const objetivoInput = new TextInputBuilder()
      .setCustomId('objetivo')
      .setLabel('Objetivo a alcançar:')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(nomeInput);
    const row2 = new ActionRowBuilder().addComponents(idadeInput);
    const row3 = new ActionRowBuilder().addComponents(foiMakerInput);
    const row4 = new ActionRowBuilder().addComponents(objetivoInput);

    modal.addComponents(row1, row2, row3, row4);
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'seja_postador') {
    const modal = new ModalBuilder()
      .setCustomId('seja_postador_modal')
      .setTitle('Seja Postador - GIFZADA');

    const nomeInput = new TextInputBuilder()
      .setCustomId('nome')
      .setLabel('Nome')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const idadeInput = new TextInputBuilder()
      .setCustomId('idade')
      .setLabel('Idade')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const pretendeEquipeInput = new TextInputBuilder()
      .setCustomId('pretende_equipe')
      .setLabel('Pretende entrar para nossa equipe?')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const conteudosInput = new TextInputBuilder()
      .setCustomId('conteudos')
      .setLabel('Onde você costuma pegar seus conteúdos?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(nomeInput);
    const row2 = new ActionRowBuilder().addComponents(idadeInput);
    const row3 = new ActionRowBuilder().addComponents(pretendeEquipeInput);
    const row4 = new ActionRowBuilder().addComponents(conteudosInput);

    modal.addComponents(row1, row2, row3, row4);
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'd2930ffe9dc94bf1bdd2d1f85db7299d') {
    const modal = new ModalBuilder()
      .setCustomId('migracao_modal')
      .setTitle('Migração - GIFZADA');

    const nomeInput = new TextInputBuilder()
      .setCustomId('nome')
      .setLabel('Nome')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const idadeInput = new TextInputBuilder()
      .setCustomId('idade')
      .setLabel('Idade')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const servidorOrigemInput = new TextInputBuilder()
      .setCustomId('servidor_origem')
      .setLabel('De qual servidor você está vindo?')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const motivoMigracaoInput = new TextInputBuilder()
      .setCustomId('motivo_migracao')
      .setLabel('Qual o motivo da sua migração?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(nomeInput);
    const row2 = new ActionRowBuilder().addComponents(idadeInput);
    const row3 = new ActionRowBuilder().addComponents(servidorOrigemInput);
    const row4 = new ActionRowBuilder().addComponents(motivoMigracaoInput);

    modal.addComponents(row1, row2, row3, row4);
    await interaction.showModal(modal);
    return;
  }

  // Handlers para botões dentro das threads
  const recruitmentRoleId = '1230677503719374990';
  const staffRoleId = '1094385139976507523';

  // Botões de assumir ticket (com sistema de pontos)
  if (['assumir_ticket_maker', 'assumir_ticket_postador', 'assumir_ticket_migracao', 'assumir_ticket_ajuda', 'assumir_ticket_denuncia'].includes(customId)) {
    // Verificar permissões específicas por tipo de ticket
    let hasPermission = false;
    let errorMessage = '';

    if (['assumir_ticket_maker', 'assumir_ticket_postador', 'assumir_ticket_migracao'].includes(customId)) {
      // Tickets de recrutamento - apenas equipe de recrutamento
      hasPermission = interaction.member.roles.cache.has(recruitmentRoleId);
      errorMessage = '❌ Apenas membros da equipe de recrutamento podem assumir tickets de recrutamento.';
    } else if (['assumir_ticket_ajuda', 'assumir_ticket_denuncia'].includes(customId)) {
      // Tickets de suporte - apenas equipe de suporte
      const supportRoleId = '1165308513355046973';
      hasPermission = interaction.member.roles.cache.has(supportRoleId);
      errorMessage = '❌ Apenas membros da equipe de suporte podem assumir tickets de ajuda e denúncia.';
    }

    if (!hasPermission) {
      return interaction.reply({
        content: errorMessage,
       flags: 1 << 6
      });
    }

    // Encontrar o usuário que abriu o ticket
    const threadName = interaction.channel.name;
    const userIdMatch = threadName.match(/(\d+)/);
    if (userIdMatch) {
      const userId = userIdMatch[1];

      // Registrar assignment do ticket
      threadAssignments.set(interaction.channel.id, {
        staffId: interaction.user.id,
        userId: userId,
        threadType: customId.replace('assumir_ticket_', '')
      });
    }

    // Desabilitar o botão "Assumir Ticket"
    const buttonRow = interaction.message.components[0];
    if (buttonRow) {
      const buttons = buttonRow.components.map(button => {
        const newButton = new ButtonBuilder()
          .setCustomId(button.customId)
          .setLabel(button.label)
          .setStyle(button.style);

        if (['assumir_ticket_maker', 'assumir_ticket_postador', 'assumir_ticket_migracao', 'assumir_ticket_ajuda', 'assumir_ticket_denuncia'].includes(button.customId)) {
          newButton.setDisabled(true);
        }

        return newButton;
      });

      const updatedRow = new ActionRowBuilder().addComponents(buttons);

      try {
        await interaction.message.edit({
          components: [updatedRow],
        });
      } catch (error) {
        console.error('Erro ao editar mensagem:', error);
      }
    }

    // Adicionar pontos silenciosamente baseado no tipo de ticket
    try {
      let pontosTipo = '';
      let pontosValor = 1;

      if (['assumir_ticket_maker', 'assumir_ticket_postador', 'assumir_ticket_migracao'].includes(customId)) {
        pontosTipo = 'recrutamento';
      } else if (['assumir_ticket_ajuda', 'assumir_ticket_denuncia'].includes(customId)) {
        pontosTipo = 'suporte';
      }

      if (pontosTipo) {
        await addMultiServerPoints(
          interaction.user.id,
          interaction.user.username,
          pontosTipo,
          pontosValor,
          interaction.channel.id,
          interaction.message.id,
          `Assumiu ticket de ${pontosTipo}`
        );

        console.log(`Pontos por assumir ticket: ${interaction.user.username} (+${pontosValor} por ${pontosTipo})`);
      }
    } catch (error) {
      console.error('Erro ao adicionar pontos por assumir ticket:', error);
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Ticket Assumido')
      .setDescription(`Este ticket foi assumido por ${interaction.user}.`)
      .setColor('#00ff00')
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // Botões de chamar staff (com cooldown)
  if (['chame_staff_maker', 'chame_staff_postador', 'chame_staff_migracao', 'chame_staff_ajuda', 'chame_staff_denuncia'].includes(customId)) {
    const channelId = interaction.channel.id;
    const now = Date.now();
    const cooldownTime = 5 * 60 * 1000; // 5 minutos em millisegundos

    if (staffMentionCooldown.has(channelId)) {
      const lastMention = staffMentionCooldown.get(channelId);
      const timeLeft = cooldownTime - (now - lastMention);

      if (timeLeft > 0) {
        const minutesLeft = Math.ceil(timeLeft / 60000);
        return interaction.reply({
          content: `⏰ Você deve aguardar ${minutesLeft} minuto(s) antes de chamar a staff novamente.`,
         flags: 1 << 6
        });
      }
    }

    staffMentionCooldown.set(channelId, now);

    await interaction.reply({
      content: `🔔 <@&${staffRoleId}> foi chamado para este ticket por ${interaction.user}.`
    });
  }

  // Botões de fechar ticket
  if (['fechar_ticket_maker', 'fechar_ticket_postador', 'fechar_ticket_migracao', 'fechar_ticket_ajuda', 'fechar_ticket_denuncia'].includes(customId)) {
    // Verificar permissões específicas por tipo de ticket
    let hasPermission = false;
    let errorMessage = '';

    if (['fechar_ticket_maker', 'fechar_ticket_postador', 'fechar_ticket_migracao'].includes(customId)) {
      // Tickets de recrutamento - apenas equipe de recrutamento
      hasPermission = interaction.member.roles.cache.has(recruitmentRoleId);
      errorMessage = '❌ Apenas membros da equipe de recrutamento podem fechar tickets de recrutamento.';
    } else if (['fechar_ticket_ajuda', 'fechar_ticket_denuncia'].includes(customId)) {
      // Tickets de suporte - apenas equipe de suporte
      const supportRoleId = '1165308513355046973';
      hasPermission = interaction.member.roles.cache.has(supportRoleId);
      errorMessage = '❌ Apenas membros da equipe de suporte podem fechar tickets de ajuda e denúncia.';
    }

    if (!hasPermission) {
      return interaction.reply({
        content: errorMessage,
       flags: 1 << 6
      });
    }

    // Verificar se há assignment para este ticket
    const assignment = threadAssignments.get(interaction.channel.id);
    if (assignment) {
      // Iniciar sistema de feedback obrigatório
      await startFeedbackSystem(interaction, assignment);
      return;
    }

    // Se não há assignment, fechar normalmente (código antigo)
    // Se for ticket de maker, enviar para apadrinhamento
    if (customId === 'fechar_ticket_maker') {
      try {
        // Buscar as informações do maker na thread
        const messages = await interaction.channel.messages.fetch({ limit: 10 });
        const makerMessage = messages.find(msg => msg.embeds.length > 0 && msg.embeds[0].title?.includes('SEJA MAKER'));

        if (makerMessage && makerMessage.embeds[0]) {
          const embed = makerMessage.embeds[0];
          const description = embed.description;

          // Extrair informações da descrição
          const nomeMatch = description.match(/\*\*Nome:\*\*\s*(.+)/);
          const idadeMatch = description.match(/\*\*Idade:\*\*\s*(.+)/);
          const foiMakerMatch = description.match(/\*\*Já foi staff de outro servidor\?\*\*\s*(.+)/);
          const objetivoMatch = description.match(/\*\*Objetivo a alcançar:\*\*\s*(.+)/);

          const nome = nomeMatch ? nomeMatch[1].trim() : 'Não informado';
          const idade = idadeMatch ? idadeMatch[1].trim() : 'Não informado';
          const foiMaker = foiMakerMatch ? foiMakerMatch[1].trim() : 'Não informado';
          const objetivo = objetivoMatch ? objetivoMatch[1].trim() : 'Não informado';

          // Canal de apadrinhamento
          const apadrinhamentoChannel = client.channels.cache.get('1231658019356672020');

          if (apadrinhamentoChannel) {
            const apadrinhamentoEmbed = new EmbedBuilder()
              .setTitle('<:1266777381188931726:1266777381188931726> | GIFZADA - APADRINHAMENTO')
              .setDescription(`
╭ ┈<:d_arrow:1366582051507273728> Seu trabalho agora é apadrinhar esse staff, fazendo com que ele saiba de todas as informações que precisa saber.

**Nome:**
${nome}
**Idade:**
${idade}
**Já foi maker de outro servidor?**
${foiMaker}
**Objetivo a alcançar:**
${objetivo}
`)
              .setColor('#9c41ff')
              .setTimestamp();

            const apadrinhamentoButton = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('apadrinhar_maker')
                .setLabel('Apadrinhar')
                .setStyle(ButtonStyle.Success)
            );

            await apadrinhamentoChannel.send({
              content: `<@&1094385139976507523>`,
              embeds: [apadrinhamentoEmbed],
              components: [apadrinhamentoButton]
            });
          }
        }
      } catch (error) {
        console.error('Erro ao enviar apadrinhamento:', error);
      }
    }

    const confirmEmbed = new EmbedBuilder()
      .setTitle('🔒 Ticket Fechado')
      .setDescription(`
Este ticket foi fechado por ${interaction.user}.

**Status:** Finalizado
**Fechado em:** ${new Date().toLocaleString('pt-BR')}

Thread será arquivada em alguns segundos...
`)
      .setColor('#ff4444')
      .setFooter({ text: 'GIFZADA RECRUTAMENTO • Ticket Finalizado' })
      .setTimestamp();

    await interaction.reply({ embeds: [confirmEmbed] });

    // Aguardar 3 segundos antes de arquivar
    setTimeout(async () => {
      try {
        await interaction.channel.setArchived(true);

        // Remover thread ativa do banco quando arquivada
        const threadName = interaction.channel.name;
        const userIdMatch = threadName.match(/(\d+)/);
        if (userIdMatch) {
          await removeActiveThread(userIdMatch[1]);
        }
      } catch (error) {
        console.error('Erro ao arquivar thread:', error);
      }
    }, 3000);
  }

  // Handler para suporte
  if (customId === 'suporte') {
    const supportEmbed = new EmbedBuilder()
      .setTitle('🔧 **CENTRAL DE SUPORTE**')
      .setDescription(`
## <:d_emoji_273:1366581300500365343> **PRECISA DE AJUDA?**

### <:zz1_ficha:1284613286850990142> **FORMATOS SUPORTADOS:**
\`\`\`yaml
Vídeos: MP4, AVI, MOV, WMV, MKV, WEBM, FLV
Imagens: PNG, JPG, JPEG, WEBP, BMP, TIFF
GIFs: Todos os tipos (animados e estáticos)
\`\`\`

### <:d_emoji_274:1366581475310309376> **LIMITES TÉCNICOS:**
\`•\` Tamanho máximo: 100MB por arquivo
\`•\` Duração vídeo: 60 segundos
\`•\` Resolução máxima: 4K (3840x2160)
\`•\` FPS máximo: 60fps

### ⚠️ **PROBLEMAS COMUNS:**
\`•\` **Arquivo muito grande?** Use um compressor online primeiro
\`•\` **Formato não suportado?** Converta para MP4 ou PNG
\`•\` **Conversão lenta?** Arquivos grandes podem demorar mais

### 📞 **CONTATO:**
\`•\` <#1218390839722639461>

> 💡 *Nossa equipe está sempre pronta para ajudar!*
`)
      .setColor('#ff6b6b')
      .setFooter({ text: 'Seja detalhado caso abra um ticket!' });

    await interaction.reply({ embeds: [supportEmbed],flags: 1 << 6 });
  }

  // Handler para verificação
  if (customId === 'verificar_se') {
    // Verificar se o usuário está bloqueado
    if (blockedVerificationUsers.has(user.id)) {
      return interaction.reply({
        content: '🚫 **Você está bloqueado pela administração**\n\nVocê não pode iniciar processos de verificação. Entre em contato com o suporte para mais informações.',
       flags: 1 << 6
      });
    }

    // Verificar se o usuário já tem uma thread de verificação ativa
    if (activeVerificationThreads.has(user.id)) {
      const existingThreadId = activeVerificationThreads.get(user.id);
      const existingThread = client.channels.cache.get(existingThreadId);

      if (existingThread && !existingThread.archived) {
        return interaction.reply({
          content: `❌ **Você já possui um processo de verificação ativo!**\n\nAcesse sua thread: ${existingThread}`,
         flags: 1 << 6
        });
      } else {
        // Se a thread não existe mais ou está arquivada, remover do mapa
        activeVerificationThreads.delete(user.id);
      }
    }

    // Enviar confirmação ephemeral antes de iniciar a verificação
    const confirmEmbed = new EmbedBuilder()
      .setTitle('📋 **CONFIRMAÇÃO DE VERIFICAÇÃO**')
      .setDescription('**ESSA VERIFICAÇÃO É PARA USUARIOS QUE QUEREM PARTICIPAR DO INSTAGRAM DO SERVIDOR, APÓS CLICAR NO BOTÃO ABAIXO, UMA THREAD PRIVADA IRÁ SE ABRIR E O PROCESSO DE VERIFICAÇÃO SE INICIARA**')
      .setColor('#9c41ff')
      .setTimestamp();

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('concordo_verificacao')
        .setLabel('Concordo')
        .setStyle(ButtonStyle.Success)
    );

    return interaction.reply({
      embeds: [confirmEmbed],
      components: [confirmRow],
      flags: 1 << 6
    });
  }

  // Handler para confirmação de verificação
  if (customId === 'concordo_verificacao') {
    // Verificar novamente se o usuário está bloqueado
    if (blockedVerificationUsers.has(user.id)) {
      return interaction.reply({
        content: '🚫 **Você está bloqueado pela administração**\n\nVocê não pode iniciar processos de verificação. Entre em contato com o suporte para mais informações.',
       flags: 1 << 6
      });
    }

    // Verificar novamente se o usuário já tem uma thread de verificação ativa
    if (activeVerificationThreads.has(user.id)) {
      const existingThreadId = activeVerificationThreads.get(user.id);
      const existingThread = client.channels.cache.get(existingThreadId);

      if (existingThread && !existingThread.archived) {
        return interaction.reply({
          content: `❌ **Você já possui um processo de verificação ativo!**\n\nAcesse sua thread: ${existingThread}`,
         flags: 1 << 6
        });
      } else {
        // Se a thread não existe mais ou está arquivada, remover do mapa
        activeVerificationThreads.delete(user.id);
      }
    }

    try {
      // Adicionar cargo temporário de verificação
      const tempVerificationRoleId = '1392263610616778752';
      const member = interaction.guild.members.cache.get(user.id);

      if (member) {
        await member.roles.add(tempVerificationRoleId);
        console.log(`Cargo temporário de verificação adicionado para ${user.username}`);
      }
    } catch (error) {
      console.error('Erro ao adicionar cargo temporário:', error);
    }

    const starterMessage = await channel.send({
      content: '‎',
      allowedMentions: { users: [] }
    });

    const thread = await starterMessage.startThread({
      name: `🔍・Verificação - ${user.username}`,
      autoArchiveDuration: 1440,
      reason: 'Processo de verificação'
    });

    starterMessage.delete().catch(() => {});

    // Registrar thread ativa
    activeVerificationThreads.set(user.id, thread.id);

    const verificationEmbed = new EmbedBuilder()
      .setTitle('**Olá! Bem-vindo(a) ao processo de verificação.**')
      .setDescription(`
Entre em um canal de voz, ligue sua câmera e siga as etapas que o verificador pedir.
A verificação é rápida e serve apenas para confirmar que você é uma pessoa real, garantindo mais segurança e autenticidade na comunidade.

**Algumas orientações importantes:**
<:d_dot43:1366581992413728830>   Esteja com boa iluminação;
<:d_dot43:1366581992413728830>   A verificação é individual — evite chamar outras pessoas junto;
<:d_dot43:1366581992413728830>   Nenhuma gravação será feita e nenhuma imagem será salva;
<:d_dot43:1366581992413728830>  Aguarde o verificador disponível no canal, ele irá conduzir tudo.

<:d_arrow:1366582051507273728> Com a verificação concluída, você terá acesso ao canal de **Instagram** e poderá enviar mídias no canal geral.

Em caso de dúvidas ou demora, mencione um dos responsáveis no chat geral ou aguarde o atendimento.

**Obrigado por colaborar.**
`)
      .setColor('#9c41ff')
      .setTimestamp();

    const verificationButtonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('assumir_verificacao')
        .setLabel('Assumir Verificação')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`verificar_usuario_${user.id}`)
        .setLabel('Verificar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('encerrar_verificacao')
        .setLabel('Encerrar')
        .setStyle(ButtonStyle.Danger)
    );

    await thread.send({ 
      content: `${user} <@&1392247839857315912>`, 
      embeds: [verificationEmbed], 
      components: [verificationButtonsRow] 
    });

    await interaction.reply({ 
      content: `**Seu processo de verificação foi iniciado!** ${thread}`, 
     flags: 1 << 6 
    });
  }

  // Handler para encerrar thread
  if (customId === 'encerrar_thread') {
    if (interaction.channel.isThread()) {
      // Limpar timer de inatividade
      clearInactivityTimer(interaction.channel.id);
      conversaoEscolha.delete(interaction.channel.id);

      await interaction.reply({ 
        content: `🔒 Thread encerrada por ${interaction.user}. A thread será trancada e arquivada.`
      });

      // Aguardar 2 segundos antes de trancar e arquivar
      setTimeout(async () => {
        try {
          // Trancar a thread primeiro
          await interaction.channel.setLocked(true);
          // Depois arquivar
          await interaction.channel.setArchived(true);
        } catch (error) {
          console.error('Erro ao trancar/arquivar thread:', error);
        }
      }, 2000);
    } else {
      await interaction.reply({ 
        content: '❌ Este comando só pode ser usado dentro de uma thread de conversão.', 
       flags: 1 << 6 
      });
    }
  }

  // Handler para encerrar thread por inatividade
  if (customId === 'encerrar_thread_inativo') {
    if (interaction.channel.isThread()) {
      // Limpar timer de inatividade
      clearInactivityTimer(interaction.channel.id);
      conversaoEscolha.delete(interaction.channel.id);

      const encerrarEmbed = new EmbedBuilder()
        .setTitle('🔒 **THREAD ENCERRADA**')
        .setDescription(`
Thread de conversão encerrada por ${interaction.user}.

**Status:** Finalizada pelo usuário
**Encerrado em:** ${new Date().toLocaleString('pt-BR')}

Thread será arquivada em alguns segundos...
`)
        .setColor('#ff4444')
        .setFooter({ text: 'GIFZADA CONVERSOR • Thread Finalizada' })
        .setTimestamp();

      await interaction.reply({ embeds: [encerrarEmbed] });

      // Aguardar 2 segundos antes de trancar e arquivar
      setTimeout(async () => {
        try {
          await interaction.channel.setLocked(true);
          await interaction.channel.setArchived(true);
        } catch (error) {
          console.error('Erro ao trancar/arquivar thread por inatividade:', error);
        }
      }, 2000);
    } else {
      await interaction.reply({ 
        content: '❌ Este comando só pode ser usado dentro de uma thread de conversão.', 
       flags: 1 << 6 
      });
    }
  }

  // Handler para botão de apadrinhar
  if (customId === 'apadrinhar_maker') {
    const hasRecruitmentRole = interaction.member.roles.cache.has(recruitmentRoleId);
    const hasStaffRole = interaction.member.roles.cache.has(staffRoleId);

    if (!hasRecruitmentRole && !hasStaffRole) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de recrutamento ou staff podem apadrinhar makers.',
       flags: 1 << 6
      });
    }

    // Atualizar a embed com o responsável
    const currentEmbed = interaction.message.embeds[0];
    const updatedEmbed = new EmbedBuilder()
      .setTitle(currentEmbed.title)
      .setDescription(currentEmbed.description + `\n\n**Responsável:** ${interaction.user}`)
      .setColor('#9c41ff')
      .setTimestamp();

    // Criar botão de mensagem de apadrinhamento
    const mensagemButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('mensagem_apadrinhamento')
        .setLabel('Mensagem Apadrinhamento')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      embeds: [updatedEmbed],
      components: [mensagemButton]
    });
  }

  // Handler para botão de mensagem de apadrinhamento
  if (customId === 'mensagem_apadrinhamento') {
    const mensagemApadrinhamento = `\`\`\`
**Bem vindo (a) aos Makers!**
**Vou te dizer algumas instruções e regras básicas sobre maker.**

**REAÇÕES AOS PEDIDOS:**
• Toda vez que você for pegar um pedido, reaja com qualquer emoji de sua preferência e após entregar o pedido, reaja com um ☑️ para simbolizar que você já entregou.

• Em #💿・pedidos﹒gif e #📀・pedidos﹒geral você pode reagir até 3 vezes simultaneamente. No restante dos canais, é apenas uma reação por vez.
• Caso você não consiga realizar o pedido, tire sua reação para dar oportunidade a outro maker fazer.

**ONDE E COMO ENTREGAR PEDIDOS?**
• Os pedidos devem ser entregues em canais do servidor. Por exemplo:
GIF de menina = #🩰・feminino-gifs;
Banner de anime: #🐳・animes, e assim vai.
• Cada pedido deve conter exatamente 6 a 10 gifs com exceção de pedidos muito difíceis e em entregas com exceto as de couple e pack os gifs/icons devem ser postados 1 por 1 (um gif/icon por mensagem).
Qualquer dúvida para saber onde postar, pergunte em #💭・suporte-maker!

**Modelo de entrega:**
(Nome do pedido)
(Marque quem pediu)
https://discord.com/channels/1182331070750933073/1329894823821312021

**ONDE ENTREGO PEDIDOS DE EDIÇÃO, EMOJI OU WALLPAPER?**
• Para edições e emoji, entregue em https://discord.com/channels/953748240589787136/1328815220247892058
• Em https://discord.com/channels/953748240589787136/1298117583639281666 para entregas de pedidos de wallpaper (lembrando que pedidos wallpaper são aceitos somente para os Vips.)

**COMO VALIDAR MEUS PONTOS FEITOS?**
• Para validar seus pontos é necessário que após a entrega você copie o link da mensagem e envie em "entregas" no canal de makers.

**O QUE SÃO FOLGADOS E COMO ANOTAR?**
• Os folgados são pessoas que não deixaram o feedback para uma entrega feita por você!
• O membro tem de 5 a 7 horas para te dar o feedback, caso não dê, coloque o ID do membro em https://discord.com/channels/1182331070750933073/1269869353864663052 e coloque o motivo. Por exemplo: 262679924576354305 - sem feedback.
\`\`\``;

    await interaction.reply({
      content: mensagemApadrinhamento,
     flags: 1 << 6
    });
  }

  if (customId.startsWith('confirm_maker_')) {
    const userId = customId.replace('confirm_maker_', '');
    const targetMember = interaction.guild.members.cache.get(userId);

    if (!targetMember) {
      return interaction.reply({
        content: 'Usuário não encontrado no servidor.',
       flags: 1 << 6
      });
    }

    try {
      // Cargos de maker
      const makerRoles = [
        '1065441749947928656',
        '1065441764460199967', 
        '1094385139976507523',
        '1224755216038236232',
        '1072027317297229875'
      ];

      await targetMember.roles.add(makerRoles);

      const successEmbed = new EmbedBuilder()
        .setTitle('Recrutamento Concluído - STAFF')
        .setDescription(`
**${targetMember.user.username}** foi recrutado como **STAFF** com sucesso!

**Cargos adicionados:**
• <@&1065441749947928656>
• <@&1065441764460199967>
• <@&1094385139976507523>
• <@&1072027317297229875>
• <@&1224755216038236232>

**Recrutado por:** ${interaction.user}
`)
        .setColor('#00ff00')
        .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      // Desabilitar botões
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('confirmed')
          .setLabel('Confirmado')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('cancelled')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );

      await interaction.update({
        embeds: [successEmbed],
        components: [disabledRow]
      });

    } catch (error) {
      console.error('Erro ao adicionar cargos de maker:', error);
      await interaction.reply({
        content: '❌ Erro ao adicionar os cargos. Verifique se o bot tem permissões adequadas.',
       flags: 1 << 6
      });
    }
  }

  if (customId.startsWith('confirm_postador_')) {
    const userId = customId.replace('confirm_postador_', '');
    const targetMember = interaction.guild.members.cache.get(userId);

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Usuário não encontrado no servidor.',
       flags: 1 << 6
      });
    }

    try {
      // Cargo de postador
      const postadorRole = '1072027317297229875';

      await targetMember.roles.add(postadorRole);

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Recrutamento Concluído - POSTADOR')
        .setDescription(`
**${targetMember.user.username}** foi recrutado como **POSTADOR** com sucesso!

**Cargo adicionado:**
• <@&1072027317297229875>

**Recrutado por:** ${interaction.user}
`)
        .setColor('#00ff00')
        .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      // Desabilitar botões
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('confirmed')
          .setLabel('Confirmado')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('cancelled')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );

      await interaction.update({
        embeds: [successEmbed],
        components: [disabledRow]
      });

    } catch (error) {
      console.error('Erro ao adicionar cargo de postador:', error);
      await interaction.reply({
        content: '❌ Erro ao adicionar o cargo. Verifique se o bot tem permissões adequadas.',
       flags: 1 << 6
      });
    }
  }

  if (customId === 'cancel_recruitment') {
    const cancelEmbed = new EmbedBuilder()
      .setTitle('❌ Recrutamento Cancelado')
      .setDescription('O processo de recrutamento foi cancelado.')
      .setColor('#ff4444')
      .setTimestamp();

    // Desabilitar botões
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirmed')
        .setLabel('Confirmar')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('cancelled')
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );

    await interaction.update({
      embeds: [cancelEmbed],
      components: [disabledRow]
    });
  }

  // Handlers para botões de feedback
  if (customId.startsWith('feedback_')) {
    const parts = customId.split('_');
    const rating = parts[1]; // excelente, bom, regular, ruim
    const threadId = parts.slice(2).join('_'); // resto é o thread ID

    const assignment = threadAssignments.get(threadId);
    if (!assignment) {
      return interaction.reply({
        content: '❌ Erro: Não foi possível processar seu feedback.',
       flags: 1 << 6
      });
    }

    // Verificar se o usuário é o dono do ticket
    if (interaction.user.id !== assignment.userId) {
      return interaction.reply({
        content: '❌ Apenas o usuário que abriu o ticket pode dar feedback.',
       flags: 1 << 6
      });
    }

    // Verificar se já foi dado feedback
    if (feedbackGiven.has(threadId)) {
      return interaction.reply({
        content: '❌ Feedback já foi registrado para este ticket.',
       flags: 1 << 6
      });
    }

    // Mapear rating para texto
    const ratingText = {
      'excelente': 'Excelente ⭐',
      'bom': 'Bom 👍',
      'regular': 'Regular 👌',
      'ruim': 'Ruim 👎'
    };

    // Registrar feedback
    await registerFeedback(threadId, interaction.user.id, ratingText[rating], assignment);

    // Cancelar timeout automático
    if (feedbackTimers.has(threadId)) {
      clearTimeout(feedbackTimers.get(threadId));
      feedbackTimers.delete(threadId);
    }

    const staffUser = await client.users.fetch(assignment.staffId);

    const successEmbed = new EmbedBuilder()
      .setTitle('✅ FEEDBACK REGISTRADO')
      .setDescription(`
**Obrigado pelo seu feedback!**

**Staff avaliado:** ${staffUser}
**Sua avaliação:** ${ratingText[rating]}
**Tipo de atendimento:** ${assignment.threadType.charAt(0).toUpperCase() + assignment.threadType.slice(1)}

Seu feedback é muito importante para melhorarmos nosso atendimento!

Thread será fechada em alguns segundos...
`)
      .setColor('#00ff00')
      .setTimestamp();

    await interaction.update({ 
      embeds: [successEmbed], 
      components: [] 
    });

    // Finalizar ticket após 3 segundos
    setTimeout(async () => {
      await finalizarTicket(interaction, assignment);
    }, 3000);
  }

  // Handlers para sistema de banimento
  if (customId.startsWith('ver_prova_solicitacao_')) {
    const solicitacaoId = customId.replace('ver_prova_solicitacao_', '');

    if (!global.banSolicitations || !global.banSolicitations.has(solicitacaoId)) {
      return interaction.reply({
        content: '❌ Solicitação não encontrada.',
        flags: 1 << 6
      });
    }

    const solicitacao = global.banSolicitations.get(solicitacaoId);

    // Verificar se é o autor da solicitação
    if (interaction.user.id !== solicitacao.requesterId) {
      return interaction.reply({
        content: '❌ Apenas quem fez a solicitação pode ver a prova.',
        flags: 1 << 6
      });
    }

    const provaEmbed = new EmbedBuilder()
      .setTitle('📎 **PROVA ANEXADA**')
      .setDescription(`**Arquivo:** ${solicitacao.anexoName}`)
      .setImage(solicitacao.anexoUrl)
      .setColor('#4169e1')
      .setTimestamp();

    await interaction.reply({ embeds: [provaEmbed], flags: 1 << 6 });
  }

  if (customId.startsWith('ver_prova_analise_')) {
    const solicitacaoId = customId.replace('ver_prova_analise_', '');

    // Verificar se tem o cargo de administrador
    if (!interaction.member.roles.cache.has('1065441743379628043')) {
      return interaction.reply({
        content: '❌ Apenas administradores podem ver as provas.',
        flags: 1 << 6
      });
    }

    if (!global.banSolicitations || !global.banSolicitations.has(solicitacaoId)) {
      return interaction.reply({
        content: '❌ Solicitação não encontrada.',
        flags: 1 << 6
      });
    }

    const solicitacao = global.banSolicitations.get(solicitacaoId);

    const provaEmbed = new EmbedBuilder()
      .setTitle('📎 **PROVA ANEXADA**')
      .setDescription(`
**Arquivo:** ${solicitacao.anexoName}
**Solicitado por:** ${solicitacao.requesterTag}
**Usuário relatado:** ${solicitacao.targetUserTag}
**Motivo:** ${solicitacao.motivo}
`)
      .setImage(solicitacao.anexoUrl)
      .setColor('#4169e1')
      .setTimestamp();

    await interaction.reply({ embeds: [provaEmbed], flags: 1 << 6 });
  }

  if (customId.startsWith('aprovar_ban_')) {
    const solicitacaoId = customId.replace('aprovar_ban_', '');

    // Verificar se tem o cargo de administrador
    if (!interaction.member.roles.cache.has('1065441743379628043')) {
      return interaction.reply({
        content: '❌ Apenas administradores podem aprovar banimentos.',
        flags: 1 << 6
      });
    }

    if (!global.banSolicitations || !global.banSolicitations.has(solicitacaoId)) {
      return interaction.reply({
        content: '❌ Solicitação não encontrada.',
        flags: 1 << 6
      });
    }

    const solicitacao = global.banSolicitations.get(solicitacaoId);

    try {
      const targetUser = await client.users.fetch(solicitacao.targetUserId);

      // Apenas atualizar embed de análise - SEM EXECUTAR BANIMENTO
      const aprovedEmbed = new EmbedBuilder()
        .setTitle('✅ **BANIMENTO APROVADO**')
        .setDescription(`
**Usuário para banir:** ${solicitacao.targetUserTag} (${solicitacao.targetUserId})
**Solicitado por:** ${solicitacao.requesterTag}
**Aprovado por:** ${interaction.user}

**Motivo:**
\`\`\`
${solicitacao.motivo}
\`\`\`

**Status:** ✅ Solicitação aprovada**
**Data de aprovação:** ${new Date().toLocaleString('pt-BR')}
`)
        .setColor('#00ff00')
        .setFooter({ text: `Solicitação: ${solicitacaoId}` })
        .setTimestamp();

      await interaction.update({ embeds: [aprovedEmbed], components: [] });

      // Buscar e atualizar a mensagem original de solicitação
      try {
        const originalChannel = client.channels.cache.get(solicitacao.channelId);
        if (originalChannel) {
          const messages = await originalChannel.messages.fetch({ limit: 50 });
          const originalMessage = messages.find(msg => 
            msg.embeds.length > 0 && 
            msg.embeds[0].title?.includes('SOLICITAÇÃO ENVIADA')
          );

          if (originalMessage) {
            const approvedOriginalEmbed = new EmbedBuilder()
              .setTitle('✅ **SOLICITAÇÃO APROVADA**')
              .setDescription(`
**Sua solicitação foi aprovada pela administração!**

**Usuário relatado:** ${solicitacao.targetUserTag}
**Motivo:** ${solicitacao.motivo}
**Aprovado por:** ${interaction.user}
**Data de aprovação:** ${new Date().toLocaleString('pt-BR')}

> ✅ *A solicitação foi aprovada. O banimento será executado em breve.*
`)
              .setColor('#00ff00')
              .setTimestamp();

            await originalMessage.edit({ embeds: [approvedOriginalEmbed], components: [] });
          }
        }
      } catch (updateError) {
        console.error('Erro ao atualizar mensagem original:', updateError);
      }

      // Atualizar status da solicitação
      solicitacao.status = 'aprovado';
      solicitacao.approvedBy = interaction.user.id;
      global.banSolicitations.set(solicitacaoId, solicitacao);

    } catch (error) {
      console.error('Erro ao processar aprovação:', error);
      await interaction.reply({
        content: `❌ Erro ao processar aprovação: ${error.message}`,
        flags: 1 << 6
      });
    }
  }

  if (customId.startsWith('rejeitar_ban_')) {
    const solicitacaoId = customId.replace('rejeitar_ban_', '');

    // Verificar se tem o cargo de administrador
    if (!interaction.member.roles.cache.has('1065441743379628043')) {
      return interaction.reply({
        content: '❌ Apenas administradores podem rejeitar banimentos.',
        flags: 1 << 6
      });
    }

    if (!global.banSolicitations || !global.banSolicitations.has(solicitacaoId)) {
      return interaction.reply({
        content: '❌ Solicitação não encontrada.',
        flags: 1 << 6
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`rejeitar_motivo_${solicitacaoId}`)
      .setTitle('Motivo da Rejeição');

    const motivoInput = new TextInputBuilder()
      .setCustomId('motivo_rejeicao')
      .setLabel('Motivo da rejeição')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Explique por que a solicitação foi rejeitada...')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(motivoInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // Handler para verificar usuário (apenas staff)
  if (customId.startsWith('verificar_usuario_')) {
    const verificationStaffRoleId = '1392247839857315912';

    if (!interaction.member.roles.cache.has(verificationStaffRoleId)) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de verificação podem usar este botão.',
       flags: 1 << 6
      });
    }

    // Verificar se este staff assumiu a verificação
    const assignedStaffId = verificationAssignments.get(interaction.channel.id);
    if (assignedStaffId && assignedStaffId !== interaction.user.id) {
      return interaction.reply({
        content: '❌ Apenas o staff que assumiu esta verificação pode usar este botão.',
       flags: 1 << 6
      });
    }

    const userId = customId.replace('verificar_usuario_', '');
    const targetMember = interaction.guild.members.cache.get(userId);

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Usuário não encontrado no servidor.',
       flags: 1 << 6
      });
    }

    try {
      // Cargos de verificação
      const verifiedRoleId = '1392229571599929465';
      const tempVerificationRoleId = '1392263610616778752';

      // Adicionar cargo de verificado
      await targetMember.roles.add(verifiedRoleId);

      // Remover cargo temporário de verificação
      try {
        await targetMember.roles.remove(tempVerificationRoleId);
        console.log(`Cargo temporário de verificação removido de ${targetMember.user.username}`);
      } catch (tempRoleError) {
        console.error('Erro ao remover cargo temporário:', tempRoleError);
      }

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Verificação Concluída')
        .setDescription(`
**${targetMember.user.username}** foi verificado com sucesso!

**Cargo adicionado:**
• <@&${verifiedRoleId}>

**Verificado por:** ${interaction.user}
`)
        .setColor('#00ff00')
        .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      await interaction.reply({
        embeds: [successEmbed]
      });

      // Aguardar 3 segundos antes de arquivar
      setTimeout(async () => {
        try {
          // Limpar o registro de quem assumiu a verificação
          verificationAssignments.delete(interaction.channel.id);

          // Remover thread ativa do usuário
          activeVerificationThreads.delete(userId);

          await interaction.channel.setArchived(true);
        } catch (error) {
          console.error('Erro ao arquivar thread de verificação:', error);
        }
      }, 3000);

    } catch (error) {
      console.error('Erro ao adicionar cargo de verificado:', error);
      await interaction.reply({
        content: '❌ Erro ao adicionar o cargo de verificado. Verifique se o bot tem permissões adequadas.',
       flags: 1 << 6
      });
    }
  }

  // Handler para assumir verificação (apenas staff)
  if (customId === 'assumir_verificacao') {
    const verificationStaffRoleId = '1392247839857315912';

    if (!interaction.member.roles.cache.has(verificationStaffRoleId)) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de verificação podem assumir verificações.',
       flags: 1 << 6
      });
    }

    // Registrar quem assumiu esta verificação
    verificationAssignments.set(interaction.channel.id, interaction.user.id);

    // Desabilitar o botão "Assumir Verificação"
    const buttonRow = interaction.message.components[0];
    if (buttonRow) {
      const buttons = buttonRow.components.map(button => {
        const newButton = new ButtonBuilder()
          .setCustomId(button.customId)
          .setLabel(button.label)
          .setStyle(button.style);

        if (button.customId === 'assumir_verificacao') {
          newButton.setDisabled(true);
        }

        return newButton;
      });

      const updatedRow = new ActionRowBuilder().addComponents(buttons);

      try {
        await interaction.message.edit({
          components: [updatedRow],
        });
      } catch (error) {
        console.error('Erro ao editar mensagem:', error);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Verificação Assumida')
      .setDescription(`Esta verificação foi assumida por ${interaction.user}.`)
      .setColor('#00ff00')
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // Handler para encerrar verificação (apenas staff)
  if (customId === 'encerrar_verificacao') {
    const verificationStaffRoleId = '1392247839857315912';

    if (!interaction.member.roles.cache.has(verificationStaffRoleId)) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de verificação podem usar este botão.',
       flags: 1 << 6
      });
    }

    // Verificar se este staff assumiu a verificação
    const assignedStaffId = verificationAssignments.get(interaction.channel.id);
    if (assignedStaffId && assignedStaffId !== interaction.user.id) {
      return interaction.reply({
        content: '❌ Apenas o staff que assumiu esta verificação pode usar este botão.',
       flags: 1 << 6
      });
    }

    let userId = null;

    // Encontrar o usuário que iniciou a verificação através do nome da thread
    const threadName = interaction.channel.name;
    const usernameMatch = threadName.match(/🔍・Verificação - (.+)/);

    if (usernameMatch) {
      const username = usernameMatch[1];
      // Buscar o membro pelo nome de usuário na thread
      const messages = await interaction.channel.messages.fetch({ limit: 50 });
      const firstMessage = messages.last();

      if (firstMessage && firstMessage.mentions.users.size > 0) {
        const mentionedUser = firstMessage.mentions.users.first();
        userId = mentionedUser.id;
        const member = interaction.guild.members.cache.get(mentionedUser.id);

        if (member) {
          try {
            // Remover cargo temporário de verificação
            const tempVerificationRoleId = '1392263610616778752';
            await member.roles.remove(tempVerificationRoleId);
            console.log(`Cargo temporário de verificação removido de ${member.user.username} (verificação encerrada)`);
          } catch (tempRoleError) {
            console.error('Erro ao remover cargo temporário no encerramento:', tempRoleError);
          }
        }
      }
    }

    const encerrarEmbed = new EmbedBuilder()
      .setTitle('🔒 Verificação Encerrada')
      .setDescription(`
Este processo de verificação foi encerrado por ${interaction.user}.

**Status:** Finalizado sem verificação
**Encerrado em:** ${new Date().toLocaleString('pt-BR')}

Thread será arquivada em alguns segundos...
`)
      .setColor('#ff4444')
      .setFooter({ text: 'GIFZADA VERIFICAÇÃO • Processo Finalizado' })
      .setTimestamp();

    await interaction.reply({ embeds: [encerrarEmbed] });

    // Aguardar 3 segundos antes de arquivar
    setTimeout(async () => {
      try {
        // Limpar o registro de quem assumiu a verificação
        verificationAssignments.delete(interaction.channel.id);

        // Remover thread ativa do usuário se encontrado
        if (userId) {
          activeVerificationThreads.delete(userId);
        }

        await interaction.channel.setArchived(true);
      } catch (error) {
        console.error('Erro ao arquivar thread de verificação:', error);
      }
    }, 3000);
  }

  // Handler para botão de configurações
  if (customId.startsWith('settings_')) {
    const postId = customId.replace('settings_', '');
    const authorId = postAuthors.get(postId);

    if (!authorId) {
      return interaction.reply({ content: '❌ Post não encontrado.',flags: 1 << 6 });
    }

    if (interaction.user.id !== authorId) {
      return interaction.reply({ content: '❌ Apenas o autor do post pode acessar as configurações.',flags: 1 << 6 });
    }

    const settingsEmbed = new EmbedBuilder()
      .setTitle('⚙️ Configurações do Post')
      .setDescription('Selecione uma opção para gerenciar seu post:')
      .setColor('#9c41ff')
      .setTimestamp();

    const settingsRow1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`delete_post_${postId}`)
        .setLabel('Deletar Postagem')
        .setEmoji('<:delete:1392242553901813881>')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`delete_comment_${postId}`)
        .setLabel('Deletar Comentário')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`private_comments_${postId}`)
        .setLabel('Privar Comentários')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary)
    );

    const settingsRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`private_likes_${postId}`)
        .setLabel('Privar Curtidas')
        .setEmoji('❤️')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [settingsEmbed], components: [settingsRow1, settingsRow2],flags: 1 << 6 });
  }

  // Handlers para blacklist
  if (customId === 'admin_add_blacklist') {
    const recruitmentRoleId = '1230677503719374990';
    const hasRecruitmentRole = interaction.member.roles.cache.has(recruitmentRoleId);

    if (!hasRecruitmentRole) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de recrutamento podem gerenciar a blacklist.',
       flags: 1 << 6
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('admin_add_blacklist_modal')
      .setTitle('Adicionar à Blacklist - Recrutamento');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para adicionar à blacklist')
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Motivo do Bloqueio')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Motivo pelo qual está sendo adicionado à blacklist...')
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(userIdInput);
    const row2 = new ActionRowBuilder().addComponents(reasonInput);
    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  }

  if (customId === 'admin_remove_blacklist') {
    const recruitmentRoleId = '1230677503719374990';
    const hasRecruitmentRole = interaction.member.roles.cache.has(recruitmentRoleId);

    if (!hasRecruitmentRole) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de recrutamento podem gerenciar a blacklist.',
       flags: 1 << 6
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('admin_remove_blacklist_modal')
      .setTitle('Remover da Blacklist - Recrutamento');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para remover da blacklist')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(userIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  if (customId === 'admin_view_blacklist') {
    const recruitmentRoleId = '1230677503719374990';
    const hasRecruitmentRole = interaction.member.roles.cache.has(recruitmentRoleId);

    if (!hasRecruitmentRole) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de recrutamento podem ver a blacklist.',
       flags: 1 << 6
      });
    }

    const blacklistUsers = await getBlacklistUsers();

    if (blacklistUsers.length === 0) {
      return interaction.reply({
        content: '📜 **Blacklist de Recrutamento vazia**\n\nNão há usuários bloqueados no sistema de recrutamento.',
       flags: 1 << 6
      });
    }

    let blacklistText = '**🚫 BLACKLIST DE RECRUTAMENTO:**\n\n';

    for (const user of blacklistUsers) {
      try {
        const discordUser = await client.users.fetch(user.user_id);
        const addedBy = await client.users.fetch(user.added_by);
        const date = new Date(user.added_at).toLocaleDateString('pt-BR');

        blacklistText += `**${discordUser.username}** (${user.user_id})\n`;
        blacklistText += `📝 **Motivo:** ${user.reason}\n`;
        blacklistText += `👤 **Adicionado por:** ${addedBy.username}\n`;
        blacklistText += `📅 **Data:** ${date}\n\n`;
      } catch (error) {
        blacklistText += `**Usuário Desconhecido** (${user.user_id})\n`;
        blacklistText += `📝 **Motivo:** ${user.reason}\n`;
        blacklistText += `📅 **Data:** ${new Date(user.added_at).toLocaleDateString('pt-BR')}\n\n`;
      }
    }

    const blacklistEmbed = new EmbedBuilder()
      .setTitle('🚫 BLACKLIST DE RECRUTAMENTO')
      .setDescription(blacklistText)
      .setColor('#ff4444')
      .setFooter({ text: `Total: ${blacklistUsers.length} usuário(s) na blacklist` })
      .setTimestamp();

    await interaction.reply({ embeds: [blacklistEmbed],flags: 1 << 6 });
  }

  // Handler para botão de bloquear usuário
  if (customId === 'admin_block_user') {
    const modal = new ModalBuilder()
      .setCustomId('admin_block_user_modal')
      .setTitle('Bloquear Usuário - Verificação');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para bloquear verificação')
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Motivo do Bloqueio (opcional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Motivo do bloqueio...')
      .setRequired(false);

    const row1 = new ActionRowBuilder().addComponents(userIdInput);
    const row2 = new ActionRowBuilder().addComponents(reasonInput);
    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  }

  if (customId === 'admin_view_blocked') {
    if (blockedVerificationUsers.size === 0) {
      return interaction.reply({
        content: '📋 **Nenhum usuário bloqueado**\n\nNão há usuários bloqueados no sistema de verificação.',
       flags: 1 << 6
      });
    }

    let blockedList = '**👥 USUÁRIOS BLOQUEADOS:**\n\n';

    for (const userId of blockedVerificationUsers) {
      try {
        const user = await client.users.fetch(userId);
        blockedList += `🚫 **${user.username}** (${user.id})\n`;
      } catch (error) {
        blockedList += `🚫 **Usuário Desconhecido** (${userId})\n`;
      }
    }

    const blockedEmbed = new EmbedBuilder()
      .setTitle('📋 USUÁRIOS BLOQUEADOS')
      .setDescription(blockedList)
      .setColor('#ff4444')
      .setFooter({ text: `Total: ${blockedVerificationUsers.size} usuário(s) bloqueado(s)` })
      .setTimestamp();

    await interaction.reply({ embeds: [blockedEmbed],flags: 1 << 6 });
  }

  if (customId === 'admin_unblock_user') {
    if (blockedVerificationUsers.size === 0) {
      return interaction.reply({
        content: '❌ Não há usuários bloqueados para desbloquear.',
       flags: 1 << 6
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('admin_unblock_user_modal')
      .setTitle('Desbloquear Usuário - Verificação');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para desbloquear verificação')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(userIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // Handlers para painéis específicos
  if (customId === 'painel_instagram') {
    const staffRoleId = '1230677503719374990';
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasStaffRole = interaction.member.roles.cache.has(staffRoleId);
    const hasAdminRole = interaction.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasStaffRole && !hasAdminRole) {
      return interaction.reply({
        content: '❌ Acesso negado.',
       flags: 1 << 6
      });
    }

    const instagramEmbed = new EmbedBuilder()
      .setTitle('📱 PAINEL INSTAGRAM')
      .setDescription(`
## 📝 **GESTÃO DE POSTS:**
Ferramentas para gerenciar postagens do Instagram

###  **AÇÕES DISPONÍVEIS:**
 **Deletar Postagem** - Remove uma postagem pelo ID da mensagem
 **Deletar Comentário** - Remove um comentário específico

##  **GESTÃO DE VERIFICAÇÃO:**
Sistema de verificação de usuários

###  **AÇÕES DISPONÍVEIS:**
 **Retirar Verificado** - Remove o cargo de verificado de um usuário
 **Bloquear Usuário** - Bloqueia usuário de usar verificação
📋 **Ver Bloqueados** - Lista todos os usuários bloqueados
 **Desbloquear Usuário** - Remove bloqueio de verificação

 Para deletar comentários, use o Post ID que aparece nos botões das postagens
`)
      .setColor('#E4405F')
      .setTimestamp();

    const instagramRow1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_delete_post')
        .setLabel('Deletar Postagem')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('admin_delete_comment')
        .setLabel('Deletar Comentário')
        .setEmoji('💬')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('admin_remove_verified')
        .setLabel('Retirar Verificado')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('admin_block_user')
        .setLabel('Bloquear Usuário')
        .setEmoji('🚫')
        .setStyle(ButtonStyle.Danger)
    );

    const instagramRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_view_blocked')
        .setLabel('Ver Bloqueados')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('admin_unblock_user')
        .setLabel('Desbloquear Usuário')
        .setEmoji('🔓')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('voltar_painel')
        .setLabel('← Voltar')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [instagramEmbed], components: [instagramRow1, instagramRow2],flags: 1 << 6 });
  }

  if (customId === 'painel_recrutamento') {
    const staffRoleId = '1230677503719374990';
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasStaffRole = interaction.member.roles.cache.has(staffRoleId);
    const hasAdminRole = interaction.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasStaffRole && !hasAdminRole) {
      return interaction.reply({
        content: '❌ Acesso negado.',
       flags: 1 << 6
      });
    }

    const recrutamentoEmbed = new EmbedBuilder()
      .setTitle(' PAINEL RECRUTAMENTO')
      .setDescription(`
##  **BLACKLIST DE RECRUTAMENTO:**
Sistema para gerenciar usuários bloqueados no recrutamento

###  **AÇÕES DISPONÍVEIS:**
 **Adicionar à Blacklist** - Bloqueia usuário de abrir tickets de recrutamento
 **Remover da Blacklist** - Remove usuário da blacklist de recrutamento
 **Ver Blacklist** - Lista todos os usuários na blacklist de recrutamento

 **Dica:** Usuários na blacklist não conseguem abrir tickets de recrutamento
`)
      .setColor('#7289DA')
      .setTimestamp();

    const recrutamentoRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_add_blacklist')
        .setLabel('Adicionar à Blacklist')
        .setEmoji('🚫')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('admin_remove_blacklist')
        .setLabel('Remover da Blacklist')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('admin_view_blacklist')
        .setLabel('Ver Blacklist')
        .setEmoji('📜')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('voltar_painel')
        .setLabel('← Voltar')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [recrutamentoEmbed], components: [recrutamentoRow],flags: 1 << 6 });
  }

  if (customId === 'painel_desempenho') {
    const staffRoleId = '1230677503719374990';
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasStaffRole = interaction.member.roles.cache.has(staffRoleId);
    const hasAdminRole = interaction.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasStaffRole && !hasAdminRole) {
      try {
        if (!interaction.replied && !interaction.deferred) {
          return await interaction.reply({
            content: '❌ Acesso negado.',
           flags: 1 << 6
          });
        }
      } catch (error) {
        console.error('Erro ao responder interação de acesso negado:', error);
        return;
      }
    }

    try {
      // Defer a resposta para ter mais tempo de processamento
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply({flags: 1 << 6 });
      }

      const performanceStats = await getStaffPerformanceStats();

      let statsText = '';

      if (performanceStats.length === 0) {
        statsText = 'Nenhum feedback registrado ainda.';
      } else {
        const staffStats = new Map();

        // Agrupar por staff
        performanceStats.forEach(stat => {
          if (!staffStats.has(stat.staff_id)) {
            staffStats.set(stat.staff_id, {
              total_feedbacks: 0,
              avg_rating: 0,
              excelente: 0,
              bom: 0,
              regular: 0,
              ruim: 0,
              automatic: 0,
              thread_types: []
            });
          }

          const staffData = staffStats.get(stat.staff_id);
          staffData.total_feedbacks += parseInt(stat.total_feedbacks);
          staffData.excelente += parseInt(stat.excelente_count);
          staffData.bom += parseInt(stat.bom_count);
          staffData.regular += parseInt(stat.regular_count);
          staffData.ruim += parseInt(stat.ruim_count);
          staffData.automatic += parseInt(stat.automatic_count);
          staffData.thread_types.push(stat.thread_type);

          // Calcular média ponderada
          staffData.avg_rating = (
            (staffData.excelente * 5) + 
            (staffData.bom * 4) + 
            (staffData.regular * 3) + 
            (staffData.ruim * 2)
          ) / staffData.total_feedbacks;
        });

        // Ordenar por média e total de feedbacks
        const sortedStaff = Array.from(staffStats.entries())
          .sort((a, b) => b[1].avg_rating - a[1].avg_rating || b[1].total_feedbacks - a[1].total_feedbacks)
          .slice(0, 10); // Top 10

        for (const [staffId, stats] of sortedStaff) {
          try {
            const staffUser = await client.users.fetch(staffId);
            const rating = stats.avg_rating.toFixed(1);
            const stars = '⭐'.repeat(Math.round(stats.avg_rating));

            statsText += `**${staffUser.username}** ${stars} (${rating}/5.0)\n`;
            statsText += `📊 **Total:** ${stats.total_feedbacks} | **✅** ${stats.excelente} **👍** ${stats.bom} **👌** ${stats.regular} **👎** ${stats.ruim}\n`;
            statsText += `🤖 **Automático:** ${stats.automatic} | **Áreas:** ${stats.thread_types.join(', ')}\n\n`;
          } catch (error) {
            statsText += `**Staff ${staffId}** - Erro ao buscar dados\n\n`;
          }
        }
      }

      const desempenhoEmbed = new EmbedBuilder()
        .setTitle(' DESEMPENHO DA EQUIPE')
        .setDescription(`
##  **RANKING DE DESEMPENHO:**

${statsText}

###  **LEGENDA:**
⭐ **Excelente** (5.0 pontos)
👍 **Bom** (4.0 pontos)
👌 **Regular** (3.0 pontos)  
👎 **Ruim** (2.0 pontos)
🤖 **Automático** - Feedback não dado pelo usuário

###  **COMO FUNCIONA:**
- Feedbacks são coletados após cada atendimento
- Se o usuário não der feedback em 5 minutos, um "Bom" automático é registrado
- A média é calculada baseada nos valores dos feedbacks
- O ranking é ordenado por média e quantidade total
`)
        .setColor('#4CAF50')
        .setTimestamp();

      const desempenhoRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('staff_individual_stats')
          .setLabel('Ver Staff Específico')
          .setEmoji('👤')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('voltar_painel')
          .setLabel('← Voltar')
          .setEmoji('🔙')
          .setStyle(ButtonStyle.Secondary)
      );

      if (interaction.deferred) {
        await interaction.editReply({ embeds: [desempenhoEmbed], components: [desempenhoRow] });
      } else if (!interaction.replied) {
        await interaction.reply({ embeds: [desempenhoEmbed], components: [desempenhoRow],flags: 1 << 6 });
      }
    } catch (error) {
      console.error('Erro ao buscar desempenho:', error);
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content: '❌ Erro ao carregar estatísticas de desempenho.'
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content: '❌ Erro ao carregar estatísticas de desempenho.',
           flags: 1 << 6
          });
        }
      } catch (replyError) {
        console.error('Erro ao responder erro de desempenho:', replyError);
      }
    }
  }

  if (customId === 'painel_administracao') {
    const adminRoles = ['1065441743379628043', '1065441744726020126', '1065441745875243008', '1317652394351525959', '1386492093303885907'];
    const hasAdminRole = interaction.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!hasAdminRole) {
      return interaction.reply({
        content: '❌ Apenas administradores podem acessar esta área.',
       flags: 1 << 6
      });
    }

    const administracaoEmbed = new EmbedBuilder()
      .setTitle(' PAINEL ADMINISTRAÇÃO')
      .setDescription(`
##  **GERENCIAMENTO DE CARGOS:**
Sistema para gerenciar hierarquia de makers

###  **HIERARQUIA DE CARGOS (do menor ao maior):**
 **Iniciante** - <@&1065441761171869796>
 **Celestial** - <@&1065441760177827930>
 **Místico** - <@&1065441759171186688>
 **Master** - <@&1065441757560574023>
 **Divindade** - <@&1065441756092571729>
 **Lendário** - <@&1065441754855260200>

###  **AÇÕES DISPONÍVEIS:**
 **Upar Usuário** - Promove usuário para cargo superior
 **Rebaixar Usuário** - Rebaixa usuário para cargo inferior
 **Remover Usuário** - Remove todos os cargos de maker

 **Dica:** O sistema segue a hierarquia automática dos cargos
`)
      .setColor('#FF6B6B')
      .setTimestamp();

    const adminRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_upar_usuario')
        .setLabel('Upar Usuário')
        .setEmoji('🔼')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('admin_rebaixar_usuario')
        .setLabel('Rebaixar Usuário')
        .setEmoji('🔽')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('admin_remover_usuario')
        .setLabel('Remover Usuário')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('voltar_painel')
        .setLabel('← Voltar')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [administracaoEmbed], components: [adminRow],flags: 1 << 6 });
  }

  if (customId === 'staff_individual_stats') {
    const modal = new ModalBuilder()
      .setCustomId('staff_individual_modal')
      .setTitle('Ver Estatísticas de Staff Específico');

    const staffIdInput = new TextInputBuilder()
      .setCustomId('staff_id')
      .setLabel('ID do Staff')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário staff para ver estatísticas')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(staffIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  if (customId === 'voltar_painel') {
    // Recriar o painel principal
    const activeThreadsCount = activeVerificationThreads.size;
    const blockedUsersCount = blockedVerificationUsers.size;
    const totalPosts = postAuthors.size;
    const totalLikes = Array.from(postLikes.values()).reduce((total, likes) => total + likes.size, 0);
    const totalComments = Array.from(postComments.values()).reduce((total, comments) => total + comments.length, 0);

    // Buscar estatísticas de feedback
    let totalFeedbacks = 0;
    try {
      const feedbackResult = await pgClient.query('SELECT COUNT(*) as count FROM staff_feedback');
      totalFeedbacks = parseInt(feedbackResult.rows[0].count);
    } catch (error) {
      console.error('Erro ao buscar total de feedbacks:', error);
    }

    const painelEmbed = new EmbedBuilder()
      .setTitle(' PAINEL ADMINISTRATIVO')
      .setDescription(`
**Painel de controle para administradores**

##  **ESTATÍSTICAS DO SISTEMA:**
\`\`\`yaml
 Verificações Ativas: ${activeThreadsCount}
 Usuários Bloqueados: ${blockedUsersCount}
 Total de Posts: ${totalPosts}
 Total de Curtidas: ${totalLikes}
 Total de Comentários: ${totalComments}
 Total de Feedbacks: ${totalFeedbacks}
\`\`\`

##  **ÁREAS DISPONÍVEIS:**

Selecione uma área para acessar suas funções específicas:

 **INSTAGRAM** - Gestão de posts e verificação
 **RECRUTAMENTO** - Sistema de blacklist e recrutamento
 **DESEMPENHO STAFF** - Estatísticas de feedback da equipe
 **ADMINISTRAÇÃO** - Gerenciamento de cargos (apenas admins)
`)
      .setColor('#9c41ff')
      .setTimestamp();

    const mainButtons1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('painel_instagram')
        .setLabel('Instagram')
        .setEmoji('📱')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('painel_recrutamento')
        .setLabel('Recrutamento')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('painel_desempenho')
        .setLabel('Desempenho Staff')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Success)
    );

    const mainButtons2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('painel_administracao')
        .setLabel('Administração')
        .setEmoji('⚖️')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.update({ embeds: [painelEmbed], components: [mainButtons1, mainButtons2] });
  }

  // Handlers para sistema de hierarquia
  if (customId === 'admin_upar_usuario') {
    const modal = new ModalBuilder()
      .setCustomId('admin_upar_usuario_modal')
      .setTitle('Upar Usuário - Hierarquia');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para upar')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(userIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  if (customId === 'admin_rebaixar_usuario') {
    const modal = new ModalBuilder()
      .setCustomId('admin_rebaixar_usuario_modal')
      .setTitle('Rebaixar Usuário - Hierarquia');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para rebaixar')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(userIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  if (customId === 'admin_remover_usuario') {
    const modal = new ModalBuilder()
      .setCustomId('admin_remover_usuario_modal')
      .setTitle('Remover Usuário - Todos os Cargos');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para remover todos os cargos')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(userIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // Handler para botões do painel administrativo
  if (customId === 'admin_delete_post') {
    const modal = new ModalBuilder()
      .setCustomId('admin_delete_post_modal')
      .setTitle('Deletar Postagem - Admin');

    const messageIdInput = new TextInputBuilder()
      .setCustomId('message_id')
      .setLabel('ID da Mensagem')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Cole o ID da mensagem aqui')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(messageIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  if (customId === 'admin_delete_comment') {
    const modal = new ModalBuilder()
      .setCustomId('admin_delete_comment_modal')
      .setTitle('Deletar Comentário - Admin');

    const postIdInput = new TextInputBuilder()
      .setCustomId('post_id')
      .setLabel('ID da Postagem')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: post_1234567890_123456789')
      .setRequired(true);

    const commentNumberInput = new TextInputBuilder()
      .setCustomId('comment_number')
      .setLabel('Número do Comentário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('1, 2, 3, etc.')
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(postIdInput);
    const row2 = new ActionRowBuilder().addComponents(commentNumberInput);
    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  }

  if (customId === 'admin_remove_verified') {
    const modal = new ModalBuilder()
      .setCustomId('admin_remove_verified_modal')
      .setTitle('Retirar Verificado - Admin');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID do Usuário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID do usuário para remover verificação')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(userIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // Handlers para botões de notificação
  if (customId === 'notify_geral') {
    const roleId = '1236336909513654385';
    const member = interaction.member;

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:emoji_272:1398746634602549248> Você removeu o cargo de **Notificações Gerais**!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:emoji_272:1398746634602549248> Você recebeu o cargo de **Notificações Gerais**!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'notify_pedidos_gif') {
    const roleId = '1065441789605068841';
    const member = interaction.member;

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:emoji_272:1398746634602549248> Você removeu o cargo de **Notificações: Pedidos-gif**!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:emoji_272:1398746634602549248> Você recebeu o cargo de **Notificações: Pedidos-gif**!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'notify_pedidos_icon') {
    const roleId = '1236336958452797523';
    const member = interaction.member;

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:emoji_272:1398746634602549248> Você removeu o cargo de **Notificações: Pedidos-Icon**!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:emoji_272:1398746634602549248> Você recebeu o cargo de **Notificações: Pedidos-Icon**!', 
       flags: 1 << 6 
      });
    }
  }

  // Handlers para botões de cor de nick
  if (customId === 'nickcolor_d') {
    // Verificar se a interação ainda é válida
    if (interaction.replied || interaction.deferred) {
      console.log('Interação já foi respondida, ignorando');
      return;
    }

    try {
      const roleId = '1065441794684362752';
      const member = interaction.member;

      // Remover todas as outras cores antes de adicionar a nova
      const colorRoles = ['1065441794684362752', '1065441793304449074', '1065441795783282898', '1236336928807321663', '1065441790972399646'];
      await member.roles.remove(colorRoles.filter(id => id !== roleId));

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ 
          content: '<:d_brush:1398752562072522843> Você removeu a cor do seu nick!', 
         flags: 1 << 6 
        });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ 
          content: '<:d_brush:1398752562072522843> Você recebeu a cor **Roxa** no seu nick!', 
         flags: 1 << 6 
        });
      }
    } catch (error) {
      console.error('Erro ao processar cor de nick:', error);
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ 
            content: '❌ Erro ao alterar cor do nick. Tente novamente.', 
           flags: 1 << 6 
          });
        } catch (replyError) {
          console.error('Erro ao responder interação:', replyError);
        }
      }
    }
  }

  if (customId === 'nickcolor_y') {
    if (interaction.replied || interaction.deferred) return;

    try {
      const roleId = '1065441793304449074';
      const member = interaction.member;

      const colorRoles = ['1065441794684362752', '1065441793304449074', '1065441795783282898', '1236336928807321663', '1065441790972399646'];
      await member.roles.remove(colorRoles.filter(id => id !== roleId));

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ 
          content: '<:y_brush:1398752431902298152> Você removeu a cor do seu nick!', 
         flags: 1 << 6 
        });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ 
          content: '<:y_brush:1398752431902298152> Você recebeu a cor **Azul** no seu nick!', 
         flags: 1 << 6 
        });
      }
    } catch (error) {
      console.error('Erro ao processar cor de nick:', error);
    }
  }

  if (customId === 'nickcolor_o') {
    if (interaction.replied || interaction.deferred) return;

    try {
      const roleId = '1065441795783282898';
      const member = interaction.member;

      const colorRoles = ['1065441794684362752', '1065441793304449074', '1065441795783282898', '1236336928807321663', '1065441790972399646'];
      await member.roles.remove(colorRoles.filter(id => id !== roleId));

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ 
          content: '<:o_brush:1398752246338027530> Você removeu a cor do seu nick!', 
         flags: 1 << 6 
        });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ 
          content: '<:o_brush:1398752246338027530> Você recebeu a cor **Verde** no seu nick!', 
         flags: 1 << 6 
        });
      }
    } catch (error) {
      console.error('Erro ao processar cor de nick:', error);
    }
  }

  if (customId === 'nickcolor_e') {
    if (interaction.replied || interaction.deferred) return;

    try {
      const roleId = '1065441790972399646';
      const member = interaction.member;

      const colorRoles = ['1065441794684362752', '1065441793304449074', '1065441795783282898', '1236336928807321663', '1065441790972399646'];
      await member.roles.remove(colorRoles.filter(id => id !== roleId));

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ 
          content: '<:e_brush:1398751907853631539> Você removeu a cor do seu nick!', 
         flags: 1 << 6 
        });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ 
          content: '<:e_brush:1398751907853631539> Você recebeu a cor **Amarela** no seu nick!', 
         flags: 1 << 6 
        });
      }
    } catch (error) {
      console.error('Erro ao processar cor de nick:', error);
    }
  }

  if (customId === 'nickcolor_f') {
    if (interaction.replied || interaction.deferred) return;

    try {
      const roleId = '1236336928807321663';
      const member = interaction.member;

      const colorRoles = ['1065441794684362752', '1065441793304449074', '1065441795783282898', '1236336928807321663', '1065441790972399646'];
      await member.roles.remove(colorRoles.filter(id => id !== roleId));

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ 
          content: '<:f_brush:1398752104285343918> Você removeu a cor do seu nick!', 
         flags: 1 << 6 
        });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ 
          content: '<:f_brush:1398752104285343918> Você recebeu a cor **Laranja** no seu nick!', 
         flags: 1 << 6 
        });
      }
    } catch (error) {
      console.error('Erro ao processar cor de nick:', error);
    }
  }

  // Handlers para cores booster - Pastéis
  if (customId === 'booster_pastel_1') {
    const roleId = '1298119975453593600';
    const member = interaction.member;

    // Remover todas as outras cores booster antes de adicionar a nova
    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:p_brush:1398758670761988157> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:p_brush:1398758670761988157> Você recebeu a cor **Pastel** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_pastel_2') {
    const roleId = '1298119805936734248';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:p_brush1:1398758933182550067> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:p_brush1:1398758933182550067> Você recebeu a cor **Pastel** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_pastel_3') {
    const roleId = '1298120196908912660';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:p_brush2:1398759046445535393> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:p_brush2:1398759046445535393> Você recebeu a cor **Pastel** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_pastel_4') {
    const roleId = '1298120108719345674';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:p_brush3:1398759435345858561> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:p_brush3:1398759435345858561> Você recebeu a cor **Pastel** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_pastel_5') {
    const roleId = '1298120431605121024';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:p_brush4:1398759757027999744> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:p_brush4:1398759757027999744> Você recebeu a cor **Pastel** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  // Handlers para cores booster - Neon
  if (customId === 'booster_neon_1') {
    const roleId = '1398736295278153901';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:n_brush:1398759884815863950> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:n_brush:1398759884815863950> Você recebeu a cor **Neon** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_neon_2') {
    const roleId = '1398736303926804530';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:n_brush1:1398759976343961712> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:n_brush1:1398759976343961712> Você recebeu a cor **Neon** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_neon_3') {
    const roleId = '1398736311032090706';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:n_brush2:1398760077686472815> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:n_brush2:1398760077686472815> Você recebeu a cor **Neon** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  // Handlers para cores booster - Metálicas
  if (customId === 'booster_metalica_1') {
    const roleId = '1398736652163219557';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:m_brush:1398760429248970753> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:m_brush:1398760429248970753> Você recebeu a cor **Metálica** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_metalica_2') {
    const roleId = '1398736647537033318';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:m_brush1:1398760537738969198> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:m_brush1:1398760537738969198> Você recebeu a cor **Metálica** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  if (customId === 'booster_metalica_3') {
    const roleId = '1398736657041068042';
    const member = interaction.member;

    const boosterRoles = [
      '1298119975453593600', '1298119805936734248', '1298120196908912660', '1298120108719345674', '1298120431605121024',
      '1398736295278153901', '1398736303926804530', '1398736311032090706',
      '1398736652163219557', '1398736647537033318', '1398736657041068042'
    ];
    await member.roles.remove(boosterRoles.filter(id => id !== roleId));

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ 
        content: '<:m_brush2:1398760653413679167> Você removeu a cor do seu nick!', 
       flags: 1 << 6 
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ 
        content: '<:m_brush2:1398760653413679167> Você recebeu a cor **Metálica** no seu nick!', 
       flags: 1 << 6 
      });
    }
  }

  // Handler para deletar comentário (autor)
  if (customId.startsWith('delete_comment_')) {
    const postId = customId.replace('delete_comment_', '');
    const comments = postComments.get(postId);

    if (!comments || comments.length === 0) {
      return interaction.reply({ content: '❌ Nenhum comentário encontrado neste post.',flags: 1 << 6 });
    }

    const commentsList = comments.map((comment, index) => {
      const user = client.users.cache.get(comment.userId);
      const username = user ? user.username : 'Usuário desconhecido';
      return `**${index + 1}.** ${username}: ${comment.comment.substring(0, 100)}${comment.comment.length > 100 ? '...' : ''}`;
    }).join('\n');

    const deleteCommentEmbed = new EmbedBuilder()
      .setTitle('🗑️ Deletar Comentário')
      .setDescription(`**Comentários neste post:**\n\n${commentsList}`)
      .setColor('#ff4444')
      .setTimestamp();

    const deleteCommentRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_delete_comment_${postId}`)
        .setLabel('Deletar')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [deleteCommentEmbed], components: [deleteCommentRow],flags: 1 << 6 });
  }

  // Handler para confirmar deletar comentário
  if (customId.startsWith('confirm_delete_comment_')) {
    const postId = customId.replace('confirm_delete_comment_', '');

    const modal = new ModalBuilder()
      .setCustomId(`delete_comment_modal_${postId}`)
      .setTitle('Deletar Comentário');

    const commentNumberInput = new TextInputBuilder()
      .setCustomId('comment_number')
      .setLabel('Número do Comentário')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('1, 2, 3, etc.')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(commentNumberInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // Handler para privar comentários
  if (customId.startsWith('private_comments_')) {
    const postId = customId.replace('private_comments_', '');

    try {
      const settings = await getPostPrivacy(postId);
      const newPrivacy = !settings.comments_private;
      await updatePostPrivacy(postId, newPrivacy, null);

      const status = newPrivacy ? 'privados' : 'públicos';
      await interaction.reply({ content: `✅ Comentários agora estão ${status}.`,flags: 1 << 6 });
    } catch (error) {
      console.error('Erro ao atualizar privacidade de comentários:', error);
      await interaction.reply({ content: '❌ Erro ao atualizar configuração.',flags: 1 << 6 });
    }
  }

  // Handler para privar curtidas
  if (customId.startsWith('private_likes_')) {
    const postId = customId.replace('private_likes_', '');

    try {
      const settings = await getPostPrivacy(postId);
      const newPrivacy = !settings.likes_private;
      await updatePostPrivacy(postId, null, newPrivacy);

      const status = newPrivacy ? 'privadas' : 'públicas';
      await interaction.reply({ content: `✅ Curtidas agora estão ${status}.`,flags: 1 << 6 });
    } catch (error) {
      console.error('Erro ao atualizar privacidade de curtidas:', error);
      await interaction.reply({ content: '❌ Erro ao atualizar configuração.',flags: 1 << 6 });
    }
  }

  // Sistema de posts - Handler para botões
  if (customId.startsWith('like_')) {
    const postId = customId.replace('like_', '');
    const userId = interaction.user.id;

    try {
      // Verificar se o post existe, se não existir, tentar criar
      let post = await getPost(postId);
      if (!post) {
        try {
          // Tentar extrair o autor do postId (formato: post_timestamp_authorId)
          const postIdParts = postId.split('_');
          if (postIdParts.length >= 3) {
            const authorId = postIdParts[2];
            await createPost(postId, authorId);
            console.log(`Post ${postId} criado automaticamente no banco`);
          } else {
            console.error('Formato de postId inválido:', postId);
            return interaction.reply({ content: '❌ Post não encontrado. ID do post inválido.',flags: 1 << 6 });
          }
        } catch (createError) {
          console.error('Erro ao criar post automaticamente:', createError);
          return interaction.reply({ content: '❌ Erro ao processar like. Post não encontrado no sistema.',flags: 1 << 6 });
        }
      }

      // Toggle like no database
      const result = await toggleLike(postId, userId);

      if (result.action === 'removed') {
        await interaction.reply({ content: '<:unlike:1392244549468033126> Você removeu seu like!',flags: 1 << 6 });
      } else {
        await interaction.reply({ content: '<:like:1392240788955598930> Você curtiu este post!',flags: 1 << 6 });
      }
    } catch (error) {
      console.error('Erro ao processar like:', error);
      return interaction.reply({ content: '❌ Erro ao processar like. Tente novamente.',flags: 1 << 6 });
    }

    // Buscar contagem atual de likes
    const likeCount = await countPostLikes(postId);

    // Verificar se a mensagem e os componentes existem
    if (!interaction.message || !interaction.message.components || interaction.message.components.length < 2) {
      console.log('Mensagem ou componentes não disponíveis para atualização');
      return;
    }

    // Atualizar botão com novo número de likes
    const currentRow1 = interaction.message.components[0];
    const currentRow2 = interaction.message.components[1];

    const updatedButtons1 = currentRow1.components.map(button => {
      if (button.customId === customId) {
        return new ButtonBuilder()
          .setCustomId(button.customId)
          .setLabel(likeCount.toString())
          .setEmoji('<:like:1392240788955598930>')
          .setStyle(ButtonStyle.Secondary);
      }

      const newButton = new ButtonBuilder()
        .setCustomId(button.customId)
        .setStyle(button.style);

      // Só adicionar label se existir e não for null
      if (button.label && button.label !== null) {
        newButton.setLabel(button.label);
      }

      // Só adicionar emoji se existir
      if (button.emoji) {
        newButton.setEmoji(button.emoji);
      }

      return newButton;
    });

    const updatedButtons2 = currentRow2.components.map(button => {
      const newButton = new ButtonBuilder()
        .setCustomId(button.customId)
        .setStyle(button.style);

      // Só adicionar label se existir e não for null
      if (button.label && button.label !== null) {
        newButton.setLabel(button.label);
      }

      // Só adicionar emoji se existir
      if (button.emoji) {
        newButton.setEmoji(button.emoji);
      }

      return newButton;
    });

    const updatedRow1 = new ActionRowBuilder().addComponents(updatedButtons1);
    const updatedRow2 = new ActionRowBuilder().addComponents(updatedButtons2);

    // Buscar webhook para editar mensagem
    try {
      const webhooks = await interaction.channel.fetchWebhooks();
      const webhook = webhooks.find(wh => wh.name === 'Post System');

      if (webhook) {
        await webhook.editMessage(interaction.message.id, { 
          content: interaction.message.content,
          components: [updatedRow1, updatedRow2] 
        });
      }
    } catch (error) {
      console.error('Erro ao atualizar botão via webhook:', error);
      // Fallback: tentar editar diretamente
      try {
        await interaction.message.edit({ components: [updatedRow1, updatedRow2] });
      } catch (fallbackError) {
        console.error('Erro no fallback:', fallbackError);
      }
    }
  }



  if (customId.startsWith('show_likes_')) {
    const postId = customId.replace('show_likes_', '');

    try {
      const post = await getPost(postId);
      if (!post) {
        return interaction.reply({ content: '❌ Post não encontrado.',flags: 1 << 6 });
      }

      const settings = await getPostPrivacy(postId);
      if (settings.likes_private) {
        return interaction.reply({ content: '🔒 A lista de curtidas desta postagem foi privada pelo autor.',flags: 1 << 6 });
      }

      const likes = await getPostLikes(postId);

      if (likes.length === 0) {
        return interaction.reply({ content: '💔 Nenhuma curtida ainda.',flags: 1 << 6 });
      }

      const likesList = likes.map(userId => `<@${userId}>`).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('❤️ Curtidas')
        .setDescription(`**${likes.length} pessoa(s) curtiram:**\n\n${likesList}`)
        .setColor('#ff69b4')
        .setTimestamp();

      await interaction.reply({ embeds: [embed],flags: 1 << 6 });
    } catch (error) {
      console.error('Erro ao buscar likes:', error);
      await interaction.reply({ content: '❌ Erro ao buscar curtidas.',flags: 1 << 6 });
    }
  }

  if (customId.startsWith('comment_')) {
    const postId = customId.replace('comment_', '');

    try {
      const post = await getPost(postId);
      if (!post) {
        return interaction.reply({ content: '❌ Post não encontrado.',flags: 1 << 6 });
      }

      const modal = new ModalBuilder()
        .setCustomId(`comment_modal_${postId}`)
        .setTitle('💬 Adicionar Comentário');

      const commentInput = new TextInputBuilder()
        .setCustomId('comment_text')
        .setLabel('Seu comentário')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Escreva seu comentário aqui...')
        .setMaxLength(1000)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(commentInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
    } catch (error) {
      console.error('Erro ao abrir modal de comentário:', error);
      await interaction.reply({ content: '❌ Erro ao abrir comentário.',flags: 1 << 6 });
    }
  }

  if (customId.startsWith('show_comments_')) {
    const postId = customId.replace('show_comments_', '');

    try {
      const post = await getPost(postId);
      if (!post) {
        return interaction.reply({ content: '❌ Post não encontrado.',flags: 1 << 6 });
      }

      const settings = await getPostPrivacy(postId);
      if (settings.comments_private) {
        return interaction.reply({ content: '🔒 A lista de comentários desta postagem foi privada pelo autor.',flags: 1 << 6 });
      }

      const comments = await getPostComments(postId);

      if (comments.length === 0) {
        return interaction.reply({ content: '💬 Nenhum comentário ainda.',flags: 1 << 6 });
      }

      const commentsList = comments.map((comment, index) => {
        const timestamp = new Date(comment.timestamp).toLocaleString('pt-BR');
        if (comment.comment === '**comentário restrito pela administração**') {
          return `**${index + 1}.** ${comment.comment}`;
        }
        return `**${index + 1}.** <@${comment.userId}> - ${timestamp}\n${comment.comment}`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle('💬 Comentários')
        .setDescription(commentsList)
        .setColor('#4169e1')
        .setTimestamp();

      await interaction.reply({ embeds: [embed],flags: 1 << 6 });
    } catch (error) {
      console.error('Erro ao buscar comentários:', error);
      await interaction.reply({ content: '❌ Erro ao buscar comentários.',flags: 1 << 6 });
    }
  }

  if (customId.startsWith('delete_post_')) {
    const postId = customId.replace('delete_post_', '');

    if (!postAuthors.has(postId)) {
      return interaction.reply({ content: '❌ Post não encontrado.',flags: 1 << 6 });
    }

    const authorId = postAuthors.get(postId);

    if (interaction.user.id !== authorId) {
      return interaction.reply({ content: '❌ Apenas o autor do post pode deletá-lo.',flags: 1 << 6 });
    }

    // Buscar a mensagem original do post no canal
    try {
      const channel = client.channels.cache.get('1392228130361708645');
      const messages = await channel.messages.fetch({ limit: 100 });

      // Procurar pela mensagem do webhook que corresponde ao post
      let postMessage = null;
      for (const message of messages.values()) {
        if (message.webhookId && message.components && message.components.length > 0) {
          const firstRow = message.components[0];
          if (firstRow.components && firstRow.components.length > 0) {
            const likeButton = firstRow.components.find(button => button.customId && button.customId.includes(postId));
            if (likeButton) {
              postMessage = message;
              break;
            }
          }
        }
      }

      if (postMessage) {
        await postMessage.delete();
      }

      // Limpar dados do post
      postLikes.delete(postId);
      postComments.delete(postId);
      postAuthors.delete(postId);
      postPrivacySettings.delete(postId);
      userCommentCount.delete(postId);

      // Salvar no database
      saveDatabase();

      await interaction.reply({ content: '🗑️ Post deletado com sucesso!',flags: 1 << 6 });
    } catch (error) {
      console.error('Erro ao deletar post:', error);
      await interaction.reply({ content: '❌ Erro ao deletar o post.',flags: 1 << 6 });
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.channel.isThread()) return;

  const tipoData = conversaoEscolha.get(message.channel.id);

  // Se for uma thread de conversor, resetar timer de inatividade
  if (tipoData) {
    resetInactivityTimer(message.channel.id, message.author.id);
  }

  const file = message.attachments.first();
  if (!tipoData || !file) return;

  // Lidar com objeto ou string
  const tipo = typeof tipoData === 'object' ? tipoData.type : tipoData;
  const extraData = typeof tipoData === 'object' ? tipoData : null;

  // Validar formato do arquivo antes do processamento
  const fileName = file.name.toLowerCase();
  const fileExtension = fileName.match(/\.[^.]*$/)?.[0];

  // Definir formatos aceitos para cada tipo de conversão
  const formatosAceitos = {
    'video-to-gif': ['.mp4', '.avi', '.mov', '.wmv', '.mkv', '.webm', '.flv'],
    'resize-gif': ['.gif'],
    'crop-image': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
    'youtube-to-gif': [], // Não aceita arquivos diretos
    'stretch-image': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'],
    'discord-banner': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
    'format-convert': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff'],
    'rename-files': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.mp4', '.avi', '.mov'],
    'separate-resolution': ['.png', '.jpg', '.jpeg', '.webp', '.bmp'],
    'color-extractor': ['.png', '.jpg', '.jpeg', '.webp', '.bmp']
  };

  const formatosPermitidos = formatosAceitos[tipo] || [];

  // Verificar se o formato é válido para o tipo de conversão selecionado
  if (formatosPermitidos.length > 0 && (!fileExtension || !formatosPermitidos.includes(fileExtension))) {
    const formatosTexto = formatosPermitidos.join(', ');
    const tipoNome = {
      'video-to-gif': 'Vídeo para GIF',
      'resize-gif': 'Redimensionar GIF',
      'crop-image': 'Cortar Imagem',
      'stretch-image': 'Esticar Imagem',
      'discord-banner': 'Banner Discord',
      'format-convert': 'Converter Formato',
      'rename-files': 'Renomear Arquivos',
      'separate-resolution': 'Separar por Resolução',
      'color-extractor': 'Extrator de Cores'
    }[tipo] || tipo;

    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ **FORMATO DE ARQUIVO INVÁLIDO**')
      .setDescription(`
╭─────────────────────────────────────╮
│   **ARQUIVO REJEITADO**             │
╰─────────────────────────────────────╯

**Conversão selecionada:** ${tipoNome}
**Arquivo enviado:** \`${file.name}\`
**Formato detectado:** \`${fileExtension || 'desconhecido'}\`

## 🚫 **PROBLEMA IDENTIFICADO:**
O formato do arquivo enviado não é compatível com o tipo de conversão selecionado.

## ✅ **FORMATOS ACEITOS PARA ${tipoNome.toUpperCase()}:**
\`\`\`
${formatosTexto}
\`\`\`

## 💡 **SOLUÇÕES:**
1️⃣ Envie um arquivo no formato correto
2️⃣ Escolha uma conversão compatível com seu arquivo
3️⃣ Converta seu arquivo para um formato aceito

> 🔄 *Selecione uma nova opção de conversão ou envie o arquivo correto*
`)
      .setColor('#ff4444')
      .setFooter({ text: '💡 Dica: Verifique sempre o formato do arquivo antes de enviar!' })
      .setTimestamp();

    await message.reply({ embeds: [errorEmbed] });
    return;
  }

  // Criar mensagem de processamento com progresso visual
  const processEmbed = new EmbedBuilder()
    .setTitle('⏳ **PROCESSAMENTO EM ANDAMENTO**')
    .setDescription(`
╭─────────────────────────────────╮
│   **Analisando seu arquivo...**  │
╰─────────────────────────────────╯

\`\`\`yaml
📁 Arquivo: ${file.name}
📊 Tamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB
🎯 Tipo: ${tipo.toUpperCase()}
⏱️ Status: Iniciando processamento...
\`\`\`

**PROGRESSO:**
\`██████████\` 100% - Carregando arquivo...

`)
    .setColor('#ffaa00')
    .setFooter({ text: '⚡ Sistema de conversão gifzada' })
    .setTimestamp();

  const aguardandoMsg = await message.channel.send({ embeds: [processEmbed] });

  // Simular progresso com atualizações
  setTimeout(async () => {
    const progressEmbed = processEmbed
      .setDescription(`
╭─────────────────────────────────╮
│   **Processando arquivo...**  │
╰─────────────────────────────────╯

\`\`\`yaml
📁 Arquivo: ${file.name}
📊 Tamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB
🎯 Tipo: ${tipo.toUpperCase()}
⏱️ Status: Convertendo...
\`\`\`

**PROGRESSO:**
\`████████░░\` 80% - Otimizando qualidade...

> 🔧 *Aplicando algoritmos de otimização avançada...*
`)
      .setColor('#8804fc');

    await aguardandoMsg.edit({ embeds: [progressEmbed] });
  }, 2000);

  try {
    // Verificar tamanho do arquivo original antes do processamento
    const originalSizeMB = file.size / 1024 / 1024;
    const maxInputSize = 100; // MB - limite para arquivo de entrada

    if (originalSizeMB > maxInputSize) {
      await aguardandoMsg.edit({
        content: `❌ **Arquivo de entrada muito grande!**\n\n` +
                `📊 **Tamanho:** ${originalSizeMB.toFixed(2)} MB\n` +
                `📋 **Limite:** ${maxInputSize} MB\n\n` +
                `💡 **Dica:** Use um arquivo menor como entrada.`,
        embeds: []
      });
      conversaoEscolha.delete(message.channel.id);
      return;
    }

    const result = await processFile(file, tipo, extraData);
    const { buffer, name, temporarios } = result;

    // Verificar tamanho do arquivo final antes de enviar
    const fileSizeBytes = buffer.length;
    const fileSizeMB = fileSizeBytes / 1024 / 1024;

    // Limite do Discord: 25MB para usuários normais
    const maxOutputSize = 25; // MB

    if (fileSizeMB > maxOutputSize) {
      await aguardandoMsg.edit({
        content: `❌ **Arquivo convertido muito grande!**\n\n` +
                `📊 **Tamanho final:** ${fileSizeMB.toFixed(2)} MB\n` +
                `📋 **Limite Discord:** ${maxOutputSize} MB\n\n` +
                `💡 **Dica:** O arquivo aumentou durante a conversão. Tente um vídeo mais curto.`,
        embeds: []
      });

      // Limpar arquivos temporários
      temporarios.forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
      conversaoEscolha.delete(message.channel.id);
      return;
    }

    const attachment = new AttachmentBuilder(buffer, { name });

    // Obter informações do arquivo
    const fileSize = fileSizeMB.toFixed(2); // MB

    // Calcular estatísticas de otimização
    const originalSize = file.size / 1024 / 1024;
    const optimizedSize = parseFloat(fileSize);
    const compression = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);
    const processingTime = Date.now() - aguardandoMsg.createdTimestamp;

    // Criar embed com informações detalhadas
    const resultEmbed = new EmbedBuilder()
      .setTitle(' **CONVERSÃO CONCLUÍDA COM SUCESSO!**')
      .setDescription(`
╭──────────────────────────────────────╮
│   **ARQUIVO OTIMIZADO COM SUCESSO**  │
╰──────────────────────────────────────╯

>  *Seu arquivo foi processado com nossa tecnologia!*

##  **ESTATÍSTICAS DA CONVERSÃO:**

\`\`\`yaml
 Arquivo Original: ${file.name}
 Arquivo Final: ${name}
 Tipo de Conversão: ${tipo.toUpperCase()}
 Tempo de Processamento: ${(processingTime / 1000).toFixed(1)}s
 Economia de Espaço: ${compression > 0 ? compression + '% menor' : 'Otimizado'}
\`\`\`

##  **CARACTERÍSTICAS TÉCNICAS:**
`)
      .setColor('#00ff88')
      .addFields(
        { 
          name: ' **Tamanho Final**', 
          value: `\`${fileSize} MB\`\n*${compression > 0 ? '🔽 ' + compression + '% reduzido' : ' Otimizado'}*`, 
          inline: true 
        },
        { 
          name: ' **Qualidade**', 
          value: `\`HD\`\n* Otimização*`, 
          inline: true 
        },
        { 
          name: ' **Velocidade**', 
          value: `\`${(processingTime / 1000).toFixed(1)}s\`\n* Processamento rápido*`, 
          inline: true 
        },
        { 
          name: ' **FPS/Taxa**', 
          value: tipo === 'video-to-gif' ? `\`30 FPS\`\n*Fluidez perfeita*` : `\`Nativo\`\n* Preservado*`, 
          inline: true 
        },
        { 
          name: ' **Resolução**', 
          value: tipo === 'crop-image' ? `\`1:1 Square\`\n* Crop inteligente*` : `\`Otimizada\`\n* Auto-ajuste*`, 
          inline: true 
        },
        { 
          name: ' **Formato**', 
          value: `\`${name.split('.').pop().toUpperCase()}\`\n* Compatível*`, 
          inline: true 
        }
      )
      .setFooter({ 
        text: ` Conversão realizada para ${message.author.username} • GIFZADA CONVERSOR`,
        iconURL: message.author.displayAvatarURL({ dynamic: true, size: 64 })
      })
      .setTimestamp();

    // Primeiro limpar completamente a mensagem de progresso
    await aguardandoMsg.edit({
      content: '🔄 **Finalizando conversão...**',
      embeds: [],
      files: [],
      components: []
    });

    // Aguardar um momento para garantir que a limpeza foi processada pelo Discord
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verificar se é extrator de cores para adicionar informações extras
    if (tipo === 'color-extractor' && result.colorData) {
      // Criar arquivo de texto com as cores
      const colorFile = new AttachmentBuilder(Buffer.from(result.colorData, 'utf8'), { name: 'cores_detalhadas.txt' });

      await aguardandoMsg.edit({ 
        content: `${message.author} **Sua conversão está pronta!**\n\n📋 **Informações das cores:**\n\`\`\`${result.colorData}\`\`\``, 
        embeds: [resultEmbed], 
        files: [attachment, colorFile],
        components: []
      });
    } else {
      // Envio normal para outras conversões
      await aguardandoMsg.edit({ 
        content: `${message.author} **Sua conversão está pronta!**`, 
        embeds: [resultEmbed], 
        files: [attachment],
        components: []
      });
    }

    // Apaga arquivos temporários após envio
    temporarios.forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
    conversaoEscolha.delete(message.channel.id);
  } catch (err) {
    console.error(err);
    const errorEmbed = new EmbedBuilder()
      .setTitle(' **ERRO NA CONVERSÃO**')
      .setDescription(`
\`\`\`yaml
 Falha no processamento
 Arquivo: ${file.name}
 Erro: ${err.message || 'Erro desconhecido'}
\`\`\`

>  *Tente novamente ou contate o suporte*
`)
      .setColor('#ff4444')
      .setTimestamp();

    await aguardandoMsg.edit({ 
      content: '', 
      embeds: [errorEmbed],
      files: []
    });
    conversaoEscolha.delete(message.channel.id);
  }
});

// Função principal de conversão
async function processFile(attachment, type, extraData = null) {
  const url = attachment.url;
  const nomeBase = Date.now();
  const temporarios = [];

  switch (type) {
    case 'video-to-gif': {
      const validFormats = ['.mp4', '.wmv', '.flv', '.mov'];
      const fileExtension = attachment.name.toLowerCase().match(/\.[^.]*$/)?.[0];

      if (!fileExtension || !validFormats.includes(fileExtension)) {
        throw new Error('Formato de vídeo não suportado. Use: .mp4, .wmv, .flv ou .mov');
      }

      const response = await fetch(url);
      const videoBuffer = await response.buffer();
      const tempInput = `temp_${nomeBase}${fileExtension}`;
      const tempOutput = `temp_${nomeBase}.gif`;
      fs.writeFileSync(tempInput, videoBuffer);
      temporarios.push(tempInput, tempOutput);

      // Conversão em duas passadas para máxima qualidade
      const tempPalette = `temp_palette_${nomeBase}.png`;
      temporarios.push(tempPalette);

      // Primeira passada: gerar paleta de cores otimizada
      await new Promise((resolve, reject) => {
        ffmpeg(tempInput)
          .outputOptions([
            '-vf', 'scale=420:-1:flags=lanczos,fps=15,palettegen=max_colors=256:reserve_transparent=0',
            '-t', '10'
          ])
          .on('end', resolve)
          .on('error', reject)
          .save(tempPalette);
      });

      // Segunda passada: aplicar paleta e gerar GIF final
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempInput)
          .input(tempPalette)
          .outputOptions([
            '-filter_complex', 'scale=420:-1:flags=lanczos,fps=15[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3',
            '-t', '10',
            '-loop', '0'
          ])
          .on('end', resolve)
          .on('error', reject)
          .save(tempOutput);
      });

      const gif = fs.readFileSync(tempOutput);
      return { buffer: gif, name: `convertido.gif`, temporarios };
    }

    case 'resize-gif': {
      if (!gifsicle) {
        throw new Error('Gifsicle não está disponível. Tente novamente em alguns segundos.');
      }

      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const input = `in_${nomeBase}.gif`;
      const output = `out_${nomeBase}.gif`;
      fs.writeFileSync(input, buffer);
      temporarios.push(input, output);

      // Calcular escala baseada na porcentagem (se não fornecida, usar 70% como padrão)
      const optimizationPercentage = (extraData && extraData.percentage) || 70;
      const scale = (100 - optimizationPercentage) / 100; // Converte porcentagem de redução para escala
      const lossyValue = Math.min(optimizationPercentage * 2, 200); // Ajustar lossy baseado na porcentagem
      const colorsValue = Math.max(256 - (optimizationPercentage * 2), 32); // Reduzir cores baseado na porcentagem

      await new Promise((resolve, reject) => {
        execFile(gifsicle, [
          '--optimize=3',
          '--lossy=' + lossyValue,
          '--colors', colorsValue.toString(),
          '--scale', scale.toString(),
          input, 
          '-o', output
        ], err => {
          if (err) return reject(err);
          resolve();
        });
      });

      const resized = fs.readFileSync(output);
      return { buffer: resized, name: `convertido.gif`, temporarios };
    }

    case 'stretch-image': {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Verificar se extraData contém os dados de stretch-image
      const stretchData = extraData || {};
      const { width, height, mode } = stretchData;

      if (!width || !height) {
        throw new Error('Dimensões não fornecidas para esticar imagem');
      }

      let resizeOptions = { width, height };

      switch(mode) {
        case 'fit':
          resizeOptions.fit = 'inside';
          resizeOptions.withoutEnlargement = true;
          break;
        case 'fill':
          resizeOptions.fit = 'cover';
          break;
        default: // stretch
          resizeOptions.fit = 'fill';
      }

      const extension = attachment.name.split('.').pop().toLowerCase();
      const stretchedImage = await sharp(buffer)
        .resize(resizeOptions)
        .toBuffer();

      return { 
        buffer: stretchedImage, 
        name: `esticado_${width}x${height}.${extension}`, 
        temporarios: [] 
      };
    }

    case 'discord-banner': {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const isGif = attachment.name.toLowerCase().endsWith('.gif') || attachment.contentType === 'image/gif';

      if (isGif) {
        const inputPath = `banner_${nomeBase}.gif`;
        const outputPath = `banner_out_${nomeBase}.gif`;
        fs.writeFileSync(inputPath, buffer);
        temporarios.push(inputPath, outputPath);

        // Obter dimensões do GIF
        const metadata = await sharp(buffer, { animated: false }).metadata();
        const { width, height } = metadata;

        // Calcular crop para 734x293 (proporção do banner do Discord)
        const targetWidth = 734;
        const targetHeight = 293;
        const targetRatio = targetWidth / targetHeight;
        const currentRatio = width / height;

        let cropWidth, cropHeight, left, top;

        if (currentRatio > targetRatio) {
          // Imagem mais larga, cortar largura
          cropHeight = height;
          cropWidth = Math.round(height * targetRatio);
          left = Math.round((width - cropWidth) / 2);
          top = 0;
        } else {
          // Imagem mais alta, cortar altura
          cropWidth = width;
          cropHeight = Math.round(width / targetRatio);
          left = 0;
          top = Math.round((height - cropHeight) / 2);
        }

        if (!gifsicle) {
          throw new Error('Gifsicle não está disponível. Tente novamente em alguns segundos.');
        }

        await new Promise((resolve, reject) => {
          execFile(gifsicle, [
            '--crop', `${left},${top}+${cropWidth}x${cropHeight}`,
            '--resize', `${targetWidth}x${targetHeight}`,
            inputPath, 
            '-o', outputPath
          ], err => {
            if (err) return reject(err);
            resolve();
          });
        });

        const bannerGif = fs.readFileSync(outputPath);
        return { buffer: bannerGif, name: `banner_discord.gif`, temporarios };
      } else {
        const metadata = await sharp(buffer).metadata();
        const { width, height } = metadata;

        // Calcular crop para banner do Discord
        const targetWidth = 734;
        const targetHeight = 293;
        const targetRatio = targetWidth / targetHeight;
        const currentRatio = width / height;

        let cropWidth, cropHeight, left, top;

        if (currentRatio > targetRatio) {
          cropHeight = height;
          cropWidth = Math.round(height * targetRatio);
          left = Math.round((width - cropWidth) / 2);
          top = 0;
        } else {
          cropWidth = width;
          cropHeight = Math.round(width / targetRatio);
          left = 0;
          top = Math.round((height - cropHeight) / 2);
        }

        const extension = attachment.name.split('.').pop().toLowerCase();
        const bannerImage = await sharp(buffer)
          .extract({ left, top, width: cropWidth, height: cropHeight })
          .resize(targetWidth, targetHeight)
          .toBuffer();

        return { 
          buffer: bannerImage, 
          name: `banner_discord.${extension}`, 
          temporarios: [] 
        };
      }
    }

    case 'format-convert': {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Verificar se extraData contém os dados de format-convert
      const formatData = extraData || {};
      const { format, quality } = formatData;

      let sharpProcessor = sharp(buffer);

      switch(format) {
        case 'jpg':
        case 'jpeg':
          sharpProcessor = sharpProcessor.jpeg({ quality });
          break;
        case 'png':
          sharpProcessor = sharpProcessor.png({ quality: Math.round(quality / 10) });
          break;
        case 'webp':
          sharpProcessor = sharpProcessor.webp({ quality });
          break;
        case 'gif':
          // Para GIF, usar gifsicle se disponível
          if (gifsicle) {
            const input = `convert_${nomeBase}.gif`;
            const output = `converted_${nomeBase}.gif`;
            fs.writeFileSync(input, buffer);
            temporarios.push(input, output);

            await new Promise((resolve, reject) => {
              execFile(gifsicle, [
                '--optimize=3',
                input, 
                '-o', output
              ], err => {
                if (err) return reject(err);
                resolve();
              });
            });

            const convertedGif = fs.readFileSync(output);
            return { buffer: convertedGif, name: `convertido.gif`, temporarios };
          }
          // Fallback para sharp
          sharpProcessor = sharpProcessor.gif();
          break;
        case 'bmp':
          // Sharp não suporta BMP nativamente, converter para PNG
          sharpProcessor = sharpProcessor.png();
          break;
        case 'tiff':
          sharpProcessor = sharpProcessor.tiff();
          break;
        default:
          sharpProcessor = sharpProcessor.png();
      }

      const convertedBuffer = await sharpProcessor.toBuffer();

      return { 
        buffer: convertedBuffer, 
        name: `convertido.${format}`, 
        temporarios: [] 
      };
    }

    case 'separate-resolution': {
      // Esta função precisa de múltiplos arquivos, retornar instruções
      throw new Error('Para separar por resolução, envie múltiplas imagens. O sistema analisará automaticamente e separará PFP (1:1) de Banners.');
    }

    case 'color-extractor': {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Usar sharp para obter estatísticas da imagem
      const { dominant } = await sharp(buffer).stats();
      const metadata = await sharp(buffer).metadata();

      // Redimensionar a imagem para análise mais rápida (máximo 200x200)
      const resizedBuffer = await sharp(buffer)
        .resize(200, 200, { fit: 'inside' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Extrair múltiplas cores da imagem
      const imageData = resizedBuffer.data;
      const { width, height } = resizedBuffer.info;
      const pixelCount = width * height;
      const colorCounts = new Map();

      // Analisar pixels em intervalos para obter cores variadas
      const sampleRate = Math.max(1, Math.floor(pixelCount / 1000)); // Máximo 1000 amostras

      for (let i = 0; i < pixelCount; i += sampleRate) {
        const pixelIndex = i * 3; // 3 bytes por pixel (RGB)
        if (pixelIndex + 2 < imageData.length) {
          const r = imageData[pixelIndex];
          const g = imageData[pixelIndex + 1];
          const b = imageData[pixelIndex + 2];

          // Agrupar cores similares (arredondar para reduzir variações)
          const roundedR = Math.round(r / 10) * 10;
          const roundedG = Math.round(g / 10) * 10;
          const roundedB = Math.round(b / 10) * 10;

          const colorKey = `${roundedR},${roundedG},${roundedB}`;
          colorCounts.set(colorKey, (colorCounts.get(colorKey) || 0) + 1);
        }
      }

      // Obter as 5 cores mais comuns
      const sortedColors = Array.from(colorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([colorKey]) => {
          const [r, g, b] = colorKey.split(',').map(Number);
          return { r, g, b };
        });

      // Adicionar a cor dominante do sharp no início
      const colors = [
        { r: dominant.r, g: dominant.g, b: dominant.b },
        ...sortedColors.slice(0, 4) // Adicionar 4 cores mais comuns
      ];

      // Converter RGB para HEX e HSL
      const colorInfo = colors.map(color => {
        const hex = `#${((1 << 24) + (color.r << 16) + (color.g << 8) + color.b).toString(16).slice(1)}`;

        // Converter para HSL
        const r = color.r / 255;
        const g = color.g / 255;
        const b = color.b / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
          h = s = 0;
        } else {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
          }
          h /= 6;
        }

        return {
          hex,
          rgb: `rgb(${color.r}, ${color.g}, ${color.b})`,
          hsl: `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
        };
      });

      // Criar uma paleta visual com as cores extraídas
      const paletteWidth = 500;
      const paletteHeight = 100;
      const colorWidth = paletteWidth / colors.length;

      // Criar SVG da paleta
      let svgContent = `<svg width="${paletteWidth}" height="${paletteHeight}" xmlns="http://www.w3.org/2000/svg">`;

      colors.forEach((color, index) => {
        const x = index * colorWidth;
        const hex = colorInfo[index].hex;
        svgContent += `<rect x="${x}" y="0" width="${colorWidth}" height="${paletteHeight}" fill="${hex}"/>`;

        // Adicionar texto com o valor HEX
        const textColor = (color.r + color.g + color.b) > 384 ? '#000000' : '#ffffff';
        svgContent += `<text x="${x + colorWidth/2}" y="${paletteHeight/2 + 5}" text-anchor="middle" fill="${textColor}" font-family="Arial" font-size="12">${hex}</text>`;
      });

      svgContent += '</svg>';

      // Converter SVG para PNG
      const paletteBuffer = await sharp(Buffer.from(svgContent))
        .png()
        .toBuffer();

      // Criar arquivo de texto com as informações das cores
      let colorData = `CORES EXTRAÍDAS DA IMAGEM:\n\n`;

      colorInfo.forEach((color, index) => {
        colorData += `Cor ${index + 1}${index === 0 ? ' (Dominante)' : ''}:\n`;
        colorData += `HEX: ${color.hex}\n`;
        colorData += `RGB: ${color.rgb}\n`;
        colorData += `HSL: ${color.hsl}\n\n`;
      });

      colorData += `Informações da Imagem:\n`;
      colorData += `Dimensões: ${metadata.width}x${metadata.height}\n`;
      colorData += `Formato: ${metadata.format}\n`;
      colorData += `Espaço de cor: ${metadata.space}\n`;
      colorData += `Canais: ${metadata.channels}\n`;

      // Retornar a paleta de cores como imagem
      return { 
        buffer: paletteBuffer, 
        name: `paleta_cores.png`, 
        temporarios: [],
        colorData: colorData
      };
    }

    case 'rename-files': {
      // Esta função precisa de múltiplos arquivos
      const renameData = extraData || {};
      const { pattern, startNumber } = renameData;

      // Para demonstração, renomear o arquivo atual
      const extension = attachment.name.split('.').pop();
      const newName = pattern
        .replace('{numero}', startNumber.toString().padStart(3, '0'))
        .replace('{data}', new Date().toISOString().slice(0, 10));

      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return { 
        buffer: buffer, 
        name: `${newName}.${extension}`, 
        temporarios: [] 
      };
    }

    case 'crop-image': {
      const response = await fetch(attachment.url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const isGif = attachment.name.toLowerCase().endsWith('.gif') || attachment.contentType === 'image/gif';

      if (isGif) {
        const inputPath = `input_${nomeBase}.gif`;
        const outputPath = `output_${nomeBase}.gif`;
        fs.writeFileSync(inputPath, buffer);
        temporarios.push(inputPath, outputPath);

        // Primeiro obter dimensões do GIF
        const metadata = await sharp(buffer, { animated: false }).metadata();
        const { width, height } = metadata;

        // Calcular o tamanho do crop (menor dimensão para fazer 1:1)
        const cropSize = Math.min(width, height);
        const left = Math.floor((width - cropSize) / 2);
        const top = Math.floor((height - cropSize) / 2);

        if (!gifsicle) {
          throw new Error('Gifsicle não está disponível. Tente novamente em alguns segundos.');
        }

        await new Promise((resolve, reject) => {
          execFile(gifsicle, [
            '--crop', `${left},${top}+${cropSize}x${cropSize}`,
            inputPath, 
            '-o', outputPath
          ], err => {
            if (err) return reject(err);
            resolve();
          });
        });

        const croppedGif = fs.readFileSync(outputPath);
        return { buffer: croppedGif, name: `convertido.gif`, temporarios };
      } else {
        const extension = attachment.name.split('.').pop().toLowerCase();

        // Obter dimensões da imagem
        const metadata = await sharp(buffer).metadata();
        const { width, height } = metadata;

        // Calcular o tamanho do crop (menor dimensão para fazer 1:1)
        const cropSize = Math.min(width, height);
        const left = Math.floor((width - cropSize) / 2);
        const top = Math.floor((height - cropSize) / 2);

        const croppedImage = await sharp(buffer)
          .extract({ 
            left: left, 
            top: top, 
            width: cropSize, 
            height: cropSize 
          })
          .toBuffer();

        return { 
          buffer: croppedImage, 
          name: `convertido.${extension || 'png'}`, 
          temporarios: [] 
        };
      }
    }

    case 'youtube-to-gif':
      throw new Error('Use o botão YouTube → GIF para inserir o link do vídeo');

    case 'batch-convert': {
      // Para conversão em lote, processar como vídeo para GIF por padrão
      const validFormats = ['.mp4', '.wmv', '.flv', '.mov', '.gif', '.png', '.jpg', '.jpeg'];
      const fileExtension = attachment.name.toLowerCase().match(/\.[^.]*$/)?.[0];

      if (!fileExtension || !validFormats.includes(fileExtension)) {
        throw new Error('Formato não suportado para conversão em lote. Use: vídeos ou imagens');
      }

      // Se for vídeo, converter para GIF
      if (['.mp4', '.wmv', '.flv', '.mov'].includes(fileExtension)) {
        const response = await fetch(url);
        const videoBuffer = await response.buffer();
        const tempInput = `batch_${nomeBase}${fileExtension}`;
        const tempOutput = `batch_${nomeBase}.gif`;
        fs.writeFileSync(tempInput, videoBuffer);
        temporarios.push(tempInput, tempOutput);

        await new Promise((resolve, reject) => {
          ffmpeg(tempInput)
            .toFormat('gif')
            .outputOptions([
              '-vf', 'scale=400:-1:flags=lanczos,fps=15',
              '-t', '8',
              '-pix_fmt', 'rgb24'
            ])
            .on('end', resolve)
            .on('error', reject)
            .save(tempOutput);
        });

        const gif = fs.readFileSync(tempOutput);
        return { buffer: gif, name: `batch_converted.gif`, temporarios };
      } 
      // Se for imagem, otimizar
      else {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const optimized = await sharp(buffer)
          .resize(800, 800, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: 85 })
          .toBuffer();

        return { 
          buffer: optimized, 
          name: `batch_optimized.jpg`, 
          temporarios: [] 
        };
      }
    }

    case 'preview-file': {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const extension = attachment.name.split('.').pop().toLowerCase();

      // Retornar arquivo original com informações
      return { 
        buffer: buffer, 
        name: `preview_${attachment.name}`, 
        temporarios: [] 
      };
    }

    default:
      throw new Error('Tipo de conversão inválido');
  }
}

// Função para baixar vídeo do TikTok usando RapidAPI
async function downloadTikTokVideoRapidAPI(videoUrl) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      url: 'https://tiktok-video-downloader-api.p.rapidapi.com/media',
      qs: {
        videoUrl: videoUrl
      },
      headers: {
        'x-rapidapi-key': 'b72f672127msh520eef841f376f8p16fe0ajsn14a57d682708',
        'x-rapidapi-host': 'tiktok-video-downloader-api.p.rapidapi.com'
      }
    };

    request(options, async function (error, response, body) {
      if (error) {
        console.error('Erro na requisição TikTok:', error);
        return reject(new Error('Erro ao conectar com a API do TikTok'));
      }

      console.log('Status da resposta TikTok:', response.statusCode);
      console.log('Resposta bruta da API TikTok:', body);

      try {
        const data = JSON.parse(body);
        console.log('Dados processados da API TikTok:', JSON.stringify(data, null, 2));

        if (data && data.downloadUrl) {
          // Usar a URL de download direta da API atual
          const downloadUrl = data.downloadUrl;

          console.log('URL de download encontrada:', downloadUrl);

          // Baixar o vídeo
          const videoResponse = await fetch(downloadUrl);
          if (!videoResponse.ok) {
            throw new Error(`Erro HTTP: ${videoResponse.status}`);
          }

          const buffer = await videoResponse.buffer();

          resolve({
            buffer: buffer,
            name: `tiktok_${Date.now()}.mp4`
          });
        } else if (data && data.data && data.data.play) {
          // Fallback para estrutura alternativa
          const downloadUrl = data.data.play;

          const videoResponse = await fetch(downloadUrl);
          if (!videoResponse.ok) {
            throw new Error(`Erro HTTP: ${videoResponse.status}`);
          }

          const buffer = await videoResponse.buffer();

          resolve({
            buffer: buffer,
            name: `tiktok_${Date.now()}.mp4`
          });
        } else if (data && data.videoUrls && data.videoUrls.length > 0) {
          // Fallback para estrutura antiga
          const downloadUrl = data.videoUrls[0];

          const videoResponse = await fetch(downloadUrl);
          if (!videoResponse.ok) {
            throw new Error(`Erro HTTP: ${videoResponse.status}`);
          }

          const buffer = await videoResponse.buffer();

          resolve({
            buffer: buffer,
            name: `tiktok_${Date.now()}.mp4`
          });
        } else {
          console.error('Estrutura de dados inesperada:', data);
          reject(new Error('Formato de resposta da API não reconhecido. Verifique se o link do TikTok está correto.'));
        }
      } catch (parseError) {
        console.error('Erro ao processar JSON:', parseError);
        console.log('Resposta que causou erro:', body);
        reject(new Error('Resposta inválida da API do TikTok. Tente novamente ou verifique o link.'));
      }
    });
  });
}

// Função para baixar vídeo do TikTok (função antiga mantida para compatibilidade)
async function downloadTikTokVideo(url) {
  try {
    // Usar uma API alternativa para TikTok
    const apiUrl = `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data && data.video && data.video.noWatermark) {
      const videoResponse = await fetch(data.video.noWatermark);
      const buffer = await videoResponse.buffer();
      return {
        buffer: buffer,
        name: `tiktok_video_${Date.now()}.mp4`
      };
    } else {
      throw new Error('Não foi possível baixar o vídeo do TikTok');
    }
  } catch (error) {
    console.error('Erro TikTok:', error);
    throw error;
  }
}

// Função para baixar vídeo do Instagram  
async function downloadInstagramVideo(url) {
  try {
    // Usar uma API alternativa para Instagram
    const apiUrl = `https://api.instagram-downloader.org/api/download?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data && data.video_url) {
      const videoResponse = await fetch(data.video_url);
      const buffer = await videoResponse.buffer();
      return {
        buffer: buffer,
        name: `instagram_video_${Date.now()}.mp4`
      };
    } else {
      throw new Error('Não foi possível baixar o vídeo do Instagram');
    }
  } catch (error) {
    console.error('Erro Instagram:', error);
    throw error;
  }
}

// Função para converter YouTube para GIF
async function convertYouTubeToGif(url, startTime = 0, duration = 5) {
  const nomeBase = Date.now();
  const tempVideo = `youtube_${nomeBase}.mp4`;
  const tempGif = `youtube_${nomeBase}.gif`;

  try {
    // Baixar vídeo do YouTube
    const stream = ytdl(url, { 
      quality: 'highest',
      filter: format => format.container === 'mp4' && format.hasVideo
    });

    // Salvar vídeo temporário
    const writeStream = fs.createWriteStream(tempVideo);
    stream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Converter para GIF com ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempVideo)
        .setStartTime(startTime)
        .setDuration(Math.min(duration, 10)) // Máximo 10 segundos
        .outputOptions([
          // Primeiro passo: gerar paleta de cores de qualidade máxima
          '-vf', 'scale=1080:-1:flags=lanczos:param0=5:param1=5,fps=24,eq=contrast=1.1:brightness=0.02:saturation=1.05,unsharp=5:5:0.8:3:3:0.4,palettegen=max_colors=256:stats_mode=diff:reserve_transparent=0',
          '-sws_flags', 'lanczos+accurate_rnd+full_chroma_int+full_chroma_inp',
          '-y'
        ])
        .output(tempGif.replace('.gif', '_palette.png'))
        .on('end', () => {
          // Segundo passo: usar a paleta para criar GIF de qualidade cinematográfica
          ffmpeg(tempVideo)
            .input(tempGif.replace('.gif', '_palette.png'))
            .setStartTime(startTime)
            .setDuration(Math.min(duration, 10))
            .outputOptions([
              '-lavfi', 
              'scale=1080:-1:flags=lanczos:param0=5:param1=5,fps=24,eq=contrast=1.1:brightness=0.02:saturation=1.05,unsharp=5:5:0.8:3:3:0.4,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff:reserve_transparent=0[p];[s1][p]paletteuse=dither=floyd_steinberg:bayer_scale=5:diff_mode=rectangle:new=1',
              '-sws_flags', 'lanczos+accurate_rnd+full_chroma_int+full_chroma_inp',
              '-loop', '0',
              '-f', 'gif'
            ])
            .toFormat('gif')
            .on('end', resolve)
            .on('error', reject)
            .save(tempGif);
        })
        .on('error', reject)
        .run();
    });

    const gifBuffer = fs.readFileSync(tempGif);

    // Limpar arquivos temporários
    [tempVideo, tempGif].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    return gifBuffer;

  } catch (error) {
    // Limpar arquivos em caso de erro
    [tempVideo, tempGif].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
    throw error;
  }
}

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Bot desligando...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Bot desligando...');
  process.exit(0);
});

client.login(process.env.TOKEN);
