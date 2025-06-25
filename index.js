
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
  TextInputStyle
} = require('discord.js');
const fs = require('fs');
const fetch = require('node-fetch');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath); 
const { execFile } = require('child_process');
const gifsicle = require('gifsicle');
const ytdl = require('@distube/ytdl-core');
const cron = require('node-cron');
const request = require('request');
const express = require('express');
require('dotenv').config();

// Criar servidor HTTP
const app = express();

app.get('/', (req, res) => {
  res.send('Bot está vivo!');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Servidor web rodando na porta 3000');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const conversaoEscolha = new Map();

client.once('ready', async () => {
  console.log(`Logado como ${client.user.tag}`);

  // Registrar comandos slash
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
      name: 'rec-maker',
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

        const unlockEmbed = new EmbedBuilder()
          .setTitle('Abertura automática GIFZADA')
          .setDescription(`Este canal foi automaticamente aberto às ${horario} conforme programado.`)
          .setColor('#9c41ff')
          .setTimestamp()
          .setFooter({ text: 'Sistema Automático de abertura' });

        await channel.send({ embeds: [unlockEmbed] });
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

        const lockEmbed = new EmbedBuilder()
          .setTitle('Fechamento Automático GIFZADA')
          .setDescription(`Este canal foi automaticamente fechado e abrirá amanhã às **${horarioAbertura}**.`)
          .setThumbnail(channel.guild.iconURL({ dynamic: true, size: 512 }))
          .setColor('#9c41ff')
          .setTimestamp()
          .setFooter({ text: 'Sistema automático de Fechamento' });

        await channel.send({ embeds: [lockEmbed] });
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
});

// Mapa para controlar cooldown de menções
const staffMentionCooldown = new Map();

client.on('messageCreate', async message => {
  // Sistema !sejamaker (apenas staff)
  if (message.content === '!sejamaker') {
    // Verificar se o usuário tem o cargo de staff
    const staffRoleId = '1094385139976507523';
    const hasStaffRole = message.member.roles.cache.has(staffRoleId);

    if (!hasStaffRole) {
      return message.reply({
        content: '❌ Apenas membros da staff podem usar este comando.',
        ephemeral: true
      });
    }

    const recruitmentEmbed = new EmbedBuilder()
      .setTitle('<:d_tag:1366581862004166656>┊GIFZADA - RECRUTAMENTO')
      .setDescription(`
<:1269199842866106458:1269199842866106458>

<:1269198470309220385:1269198470309220385> Colabore com a comunidade sendo maker ou postador!

<:1266748851050774540:1266748851050774540> | **Qual é a função do Maker?**
1. São os responsáveis pela entrega de GIFs, Icons, Emojis e edições;
2. Eles compõem a nossa equipe e mantêm o servidor ativo;
3. Tem a obrigação de subir de cargo no servidor até se tornar parte da staff!

<:1266748851050774540:1266748851050774540> | **Qual a função do Postador?**
1. São responsáveis por trazer o conteúdo para o servidor sem entrega de pedidos;
2. Caso queira ser postador, tenha em mente que se um dia queira virar maker, entrará com o cargo inicial.

<:1266748851050774540:1266748851050774540> | **Como faço para Migrar?**
<:1269198470309220385:1269198470309220385> Basta fazer o formulário na opção de migração e responder às seguintes dúvidas, aceitamos migrações apenas de outros servidores de GIF's!
`)
      .setColor('#9c41ff')
      .setImage('https://cdn.discordapp.com/attachments/1385367538409410723/1386788085664321628/APoeGPo.png?ex=685afa8c&is=6859a90c&hm=e536d88518a990b8c762f742c2a352dad67d47ffd18738addb5d689d13d01f97&')
      .setThumbnail(message.guild.iconURL({ dynamic: true, size: 512 }));

    const recruitmentRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('seja_maker')
        .setLabel('Seja Maker')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('seja_postador')
        .setLabel('Seja Postador')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('migracao')
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
});

client.on('interactionCreate', async interaction => {
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

    // Verificar se o usuário tem algum dos cargos autorizados
    const hasAuthorizedRole = member.roles.cache.some(role => authorizedRoles.includes(role.id));

    if (!hasAuthorizedRole) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando. Apenas membros da staff podem usar comandos de bloqueio/desbloqueio.',
        ephemeral: true
      });
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

        await interaction.reply({ embeds: [lockEmbed], ephemeral: true });
      } catch (error) {
        console.error('Erro ao fechar canal:', error);
        await interaction.reply({
          content: '❌ Erro ao fechar o canal. Verifique se o bot tem as permissões necessárias.',
          ephemeral: true
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

        await interaction.reply({ embeds: [unlockEmbed], ephemeral: true });
      } catch (error) {
        console.error('Erro ao abrir canal:', error);
        await interaction.reply({
          content: '❌ Erro ao abrir o canal. Verifique se o bot tem as permissões necessárias.',
          ephemeral: true
        });
      }
    }

    if (commandName === 'rec-maker') {
      // Verificar se é staff
      const staffRoleId = '1094385139976507523';
      const hasStaffRole = member.roles.cache.has(staffRoleId);

      if (!hasStaffRole) {
        return interaction.reply({
          content: '❌ Apenas membros da staff podem usar este comando.',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('usuario');
      
      // Buscar o membro com mais detalhes, incluindo fetch se necessário
      let targetMember;
      try {
        targetMember = await interaction.guild.members.fetch(targetUser.id);
      } catch (error) {
        console.error('Erro ao buscar membro:', error);
        return interaction.reply({
          content: '❌ Usuário não encontrado no servidor ou não foi possível acessar suas informações.',
          ephemeral: true
        });
      }

      if (!targetMember) {
        return interaction.reply({
          content: '❌ Usuário não encontrado no servidor.',
          ephemeral: true
        });
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('📋 Confirmação de Recrutamento - MAKER')
        .setDescription(`
**Confirme abaixo os dados antes de setar o cargo**

**Usuário:** ${targetUser.username} (${targetUser})

**Cargos que serão adicionados:**
• <@&1065441764460199967>
• <@&1065441761171869796>
• <@&1072027317297229875>
• <@&1224755216038236232>
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
        ephemeral: true
      });
    }

    if (commandName === 'rec-postador') {
      // Verificar se é staff
      const staffRoleId = '1094385139976507523';
      const hasStaffRole = member.roles.cache.has(staffRoleId);

      if (!hasStaffRole) {
        return interaction.reply({
          content: '❌ Apenas membros da staff podem usar este comando.',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('usuario');
      
      // Buscar o membro com mais detalhes, incluindo fetch se necessário
      let targetMember;
      try {
        targetMember = await interaction.guild.members.fetch(targetUser.id);
      } catch (error) {
        console.error('Erro ao buscar membro:', error);
        return interaction.reply({
          content: '❌ Usuário não encontrado no servidor ou não foi possível acessar suas informações.',
          ephemeral: true
        });
      }

      if (!targetMember) {
        return interaction.reply({
          content: '❌ Usuário não encontrado no servidor.',
          ephemeral: true
        });
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('📋 Confirmação de Recrutamento - POSTADOR')
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
        ephemeral: true
      });
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    // Handler para modal de Seja Maker
    if (interaction.customId === 'seja_maker_modal') {
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
        .setTitle('<:1266777381188931726:1266777381188931726> | GIFZADA - SEJA MAKER')
        .setDescription(`
<:1266748851050774540:1266748851050774540> | Como maker, sua principal obrigação é trazer conteúdo para o servidor atendendo à pedidos feitos pelos membros!
<:1269198470309220385:1269198470309220385> Seu objetivo deve ser upar para a staff de forma esforçada e comprometida.

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

      await interaction.reply({ 
        content: `**Seu ticket de recrutamento foi aberto com sucesso!** ${thread}`, 
        ephemeral: true 
      });
    }

    // Handler para modal de Seja Postador
    if (interaction.customId === 'seja_postador_modal') {
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

      await interaction.reply({ 
        content: `**Seu ticket de recrutamento foi aberto com sucesso!** ${thread}`, 
        ephemeral: true 
      });
    }

    // Handler para modal de Ajuda
    if (interaction.customId === 'ajuda_modal') {
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

      await interaction.reply({ 
        content: `**Seu ticket de suporte foi aberto com sucesso!** ${thread}`, 
        ephemeral: true 
      });
    }

    // Handler para modal de Denúncia
    if (interaction.customId === 'denuncia_modal') {
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

      await interaction.reply({ 
        content: `**Seu ticket de denúncia foi aberto com sucesso!** ${thread}`, 
        ephemeral: true 
      });
    }

    // Handler para modal de Migração
    if (interaction.customId === 'migracao_modal') {
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

      await interaction.reply({ 
        content: `**Seu ticket de recrutamento foi aberto com sucesso!** ${thread}`, 
        ephemeral: true 
      });
    }

    if (interaction.customId === 'youtube_modal') {
      const youtubeUrl = interaction.fields.getTextInputValue('youtube_url');
      const startTime = interaction.fields.getTextInputValue('start_time') || '0';
      const duration = interaction.fields.getTextInputValue('duration') || '5';

      if (!youtubeUrl) {
        return interaction.reply({
          content: '❌ Por favor, forneça um link válido do YouTube.',
          ephemeral: true
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
          ephemeral: true
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

    if (interaction.customId === 'tiktok_download_modal') {
      const tiktokUrl = interaction.fields.getTextInputValue('tiktok_url');

      if (!tiktokUrl) {
        return interaction.reply({
          content: '❌ Por favor, forneça um link válido do TikTok.',
          ephemeral: true
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
          ephemeral: true
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

  if (!interaction.isButton()) return;

  const { customId, user, channel } = interaction;

  if (customId === 'abrir_conversor') {
    const starterMessage = await channel.send({
      content: '‎', 
      allowedMentions: { users: [] }
    });

    const thread = await starterMessage.startThread({
      name: `🎞️ | Conversão - ${user.username}`,
      autoArchiveDuration: 60,
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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('video_to_gif')
        .setLabel('Vídeo para GIF')
        .setEmoji('<:videotogif:1366159226891931688>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('resize_gif')
        .setLabel('Redimensionar GIF')
        .setEmoji('<:resize:1366160012774477824>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('crop_image')
        .setLabel('Cortar Imagem')
        .setEmoji('<:crop:1366160563872202892>')
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('youtube_to_gif')
        .setLabel('YouTube para GIF')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('<:youtube:1386479955936022630>'),
      new ButtonBuilder()
        .setCustomId('download_tiktok')
        .setLabel('Download TikTok Video')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('<:tiktok:1386523276171280495>'),
      new ButtonBuilder()
        .setCustomId('encerrar_thread')
        .setLabel('Encerrar')
        .setStyle(ButtonStyle.Danger)
    );

    await thread.send({ content: `${user}`, embeds: [embed], components: [row, row2] });

    // Verificar se a interação ainda é válida antes de responder
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Thread criada com sucesso!', ephemeral: true });
      } catch (error) {
        console.error('Erro ao responder interação:', error);
        // Se a interação expirou, tentar enviar uma mensagem normal
        if (error.code === 10062) {
          console.log('Interação expirou, thread criada com sucesso');
        }
      }
    }
  }

  const tipos = {
    video_to_gif: 'video-to-gif',
    resize_gif: 'resize-gif',
    crop_image: 'crop-image',
    youtube_to_gif: 'youtube-to-gif'
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

    // Para outros tipos, definir escolha e responder
    conversaoEscolha.set(interaction.channel.id, tipos[customId]);

    const responseMessages = {
      'video-to-gif': '**Conversão Vídeo → GIF** selecionada!\n> Envie seu arquivo de vídeo (.mp4, .avi, .mov, .wmv, .mkv)',
      'crop-image': '**Cortar Imagem** selecionado!\n> Envie sua imagem ou GIF para recorte 1:1'
    };

    const embed = new EmbedBuilder()
      .setTitle(' **OPÇÃO SELECIONADA**')
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

  // Handler para download TikTok
  if (customId === 'download_tiktok') {
    const modal = new ModalBuilder()
      .setCustomId('tiktok_download_modal')
      .setTitle('Download TikTok Video');

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
  if (customId === 'seja_maker') {
    const modal = new ModalBuilder()
      .setCustomId('seja_maker_modal')
      .setTitle('Seja Maker - GIFZADA');

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
      .setLabel('Já foi maker de outro servidor de GIFS?')
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

  if (customId === 'migracao') {
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

  // Botões de assumir ticket
  if (['assumir_ticket_maker', 'assumir_ticket_postador', 'assumir_ticket_migracao', 'assumir_ticket_ajuda', 'assumir_ticket_denuncia'].includes(customId)) {
    const hasRecruitmentRole = interaction.member.roles.cache.has(recruitmentRoleId);

    if (!hasRecruitmentRole) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de recrutamento podem assumir tickets.',
        ephemeral: true
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
        // Lidar com o erro conforme necessário
      }
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
          ephemeral: true
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
    const hasRecruitmentRole = interaction.member.roles.cache.has(recruitmentRoleId);

    if (!hasRecruitmentRole) {
      return interaction.reply({
        content: '❌ Apenas membros da equipe de recrutamento podem fechar tickets.',
        ephemeral: true
      });
    }

    // Se for ticket de maker, enviar para apadrinhamento
    if (customId === 'fechar_ticket_maker') {
      try {
        // Buscar todas as mensagens da thread para encontrar a embed do maker
        const messages = await interaction.channel.messages.fetch({ limit: 50 });
        const makerMessage = messages.find(msg => 
          msg.embeds.length > 0 && 
          msg.embeds[0].title && 
          msg.embeds[0].title.includes('SEJA MAKER')
        );

        if (makerMessage && makerMessage.embeds[0]) {
          const embed = makerMessage.embeds[0];
          const description = embed.description;

          console.log('Descrição encontrada:', description); // Debug

          // Extrair informações da descrição com regex mais robustos
          const nomeMatch = description.match(/\*\*Nome:\*\*\s*\n?(.+?)(?=\n\*\*|\n$|$)/s);
          const idadeMatch = description.match(/\*\*Idade:\*\*\s*\n?(.+?)(?=\n\*\*|\n$|$)/s);
          const foiMakerMatch = description.match(/\*\*Já foi maker de outro servidor de GIFS\?\*\*\s*\n?(.+?)(?=\n\*\*|\n$|$)/s);
          const objetivoMatch = description.match(/\*\*Objetivo a alcançar:\*\*\s*\n?(.+?)(?=\nCaso|\n$|$)/s);

          const nome = nomeMatch ? nomeMatch[1].trim() : 'Não informado';
          const idade = idadeMatch ? idadeMatch[1].trim() : 'Não informado';
          const foiMaker = foiMakerMatch ? foiMakerMatch[1].trim() : 'Não informado';
          const objetivo = objetivoMatch ? objetivoMatch[1].trim() : 'Não informado';

          console.log('Dados extraídos:', { nome, idade, foiMaker, objetivo }); // Debug

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

**Usuário:** <@${interaction.channel.name.split('・')[1]}>
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

            console.log('Apadrinhamento enviado com sucesso!'); // Debug
          } else {
            console.error('Canal de apadrinhamento não encontrado!');
          }
        } else {
          console.error('Mensagem de maker não encontrada na thread!');
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

    await interaction.reply({ embeds: [supportEmbed], ephemeral: true });
  }

  // Handler para encerrar thread
  if (customId === 'encerrar_thread') {
    if (interaction.channel.isThread()) {
      const confirmEmbed = new EmbedBuilder()
        .setTitle('🔚 **THREAD ENCERRADA**')
        .setDescription(`
> 👤 Esta thread de conversão foi encerrada por ${interaction.user}.

**Thread arquivada com sucesso!**

\`\`\`yaml
📊 Status: Finalizada
👤 Solicitado por: ${interaction.user.username}
⏰ Encerrada em: ${new Date().toLocaleString('pt-BR')}
\`\`\`
`)
        .setColor('#ff4444')
        .setFooter({ text: 'GIFZADA CONVERTER PRO • Thread Finalizada' })
        .setTimestamp();

      await interaction.reply({ embeds: [confirmEmbed] });

      // Aguardar 3 segundos antes de arquivar
      setTimeout(async () => {
        try {
          await interaction.channel.setArchived(true);
        } catch (error) {
          console.error('Erro ao arquivar thread:', error);
        }
      }, 3000);
    } else {
      await interaction.reply({ 
        content: '❌ Este comando só pode ser usado dentro de uma thread de conversão.', 
        ephemeral: true 
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
        ephemeral: true
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
      ephemeral: true
    });
  }

  if (customId.startsWith('confirm_maker_')) {
    const userId = customId.replace('confirm_maker_', '');
    
    // Buscar o membro com fetch para garantir dados atualizados
    let targetMember;
    try {
      targetMember = await interaction.guild.members.fetch(userId);
    } catch (error) {
      console.error('Erro ao buscar membro para confirmação maker:', error);
      return interaction.reply({
        content: '❌ Usuário não encontrado no servidor ou não foi possível acessar suas informações.',
        ephemeral: true
      });
    }

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Usuário não encontrado no servidor.',
        ephemeral: true
      });
    }

    try {
      // Cargos de maker
      const makerRoles = [
        '1065441764460199967',
        '1065441761171869796', 
        '1072027317297229875',
        '1224755216038236232'
      ];

      await targetMember.roles.add(makerRoles);

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Recrutamento Concluído - MAKER')
        .setDescription(`
**${targetMember.user.username}** foi recrutado como **MAKER** com sucesso!

**Cargos adicionados:**
• <@&1065441764460199967>
• <@&1065441761171869796>
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
        ephemeral: true
      });
    }
  }

  if (customId.startsWith('confirm_postador_')) {
    const userId = customId.replace('confirm_postador_', '');
    
    // Buscar o membro com fetch para garantir dados atualizados
    let targetMember;
    try {
      targetMember = await interaction.guild.members.fetch(userId);
    } catch (error) {
      console.error('Erro ao buscar membro para confirmação postador:', error);
      return interaction.reply({
        content: '❌ Usuário não encontrado no servidor ou não foi possível acessar suas informações.',
        ephemeral: true
      });
    }

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Usuário não encontrado no servidor.',
        ephemeral: true
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
        ephemeral: true
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
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.channel.isThread()) return;

  const tipoData = conversaoEscolha.get(message.channel.id);
  const file = message.attachments.first();
  if (!tipoData || !file) return;

  // Lidar com objeto ou string
  const tipo = typeof tipoData === 'object' ? tipoData.type : tipoData;
  const percentage = typeof tipoData === 'object' ? tipoData.percentage : null;

  // Validação de formato de arquivo
  const fileName = file.name.toLowerCase();
  const fileExtension = fileName.match(/\.[^.]*$/)?.[0];

  // Definir formatos válidos para cada tipo
  const formatosValidos = {
    'video-to-gif': ['.mp4', '.wmv', '.flv', '.mov', '.avi', '.mkv', '.webm'],
    'resize-gif': ['.gif'],
    'crop-image': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
  };

  // Verificar se o formato é válido para o tipo selecionado
  if (formatosValidos[tipo] && fileExtension) {
    if (!formatosValidos[tipo].includes(fileExtension)) {
      const formatosEsperados = formatosValidos[tipo].join(', ');
      
      const errorEmbed = new EmbedBuilder()
        .setTitle(' **FORMATO INCORRETO**')
        .setDescription(`
╭─────────────────────────────────╮
│   **Formato não compatível!**   │
╰─────────────────────────────────╯

\`\`\`yaml
 Conversão Selecionada: ${tipo.toUpperCase()}
 Arquivo Enviado: ${file.name}
 Formato Detectado: ${fileExtension}
 Formatos Esperados: ${formatosEsperados}
\`\`\`

##  **O QUE FAZER:**

${tipo === 'video-to-gif' ? 
  `###  **Para Vídeo → GIF:**
   \`•\` Envie um arquivo de **vídeo**
   \`•\` Formatos aceitos: **MP4, AVI, MOV, WMV, MKV, WEBM**
   \`•\` O arquivo enviado é um **${fileExtension.replace('.', '').toUpperCase()}**` : 
  tipo === 'resize-gif' ?
  `###  **Para Redimensionar GIF:**
   \`•\` Envie um arquivo **GIF animado**
   \`•\` Formato aceito: **GIF**
   \`•\` O arquivo enviado é um **${fileExtension.replace('.', '').toUpperCase()}**` :
  `###  **Para Cortar Imagem:**
   \`•\` Envie uma **imagem** ou **GIF**
   \`•\` Formatos aceitos: **PNG, JPG, JPEG, GIF, WEBP, BMP**
   \`•\` O arquivo enviado é um **${fileExtension.replace('.', '').toUpperCase()}**`
}

>  **Envie o arquivo correto ou escolha uma nova opção de conversão**
`)
        .setColor('#ff4444')
        .setFooter({ text: 'Verifique o formato do arquivo e tente novamente' })
        .setTimestamp();

      await message.channel.send({ embeds: [errorEmbed] });
      return;
    }
  }

  // Criar mensagem de processamento com progresso visual
  const processEmbed = new EmbedBuilder()
    .setTitle(' **PROCESSAMENTO EM ANDAMENTO**')
    .setDescription(`
╭─────────────────────────────────╮
│   **Analisando seu arquivo...**  │
╰─────────────────────────────────╯

\`\`\`yaml
 Arquivo: ${file.name}
 Tamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB
 Tipo: ${tipo.toUpperCase()}
 Status: Iniciando processamento...
\`\`\`

**PROGRESSO:**
\`██████████\` 100% - Carregando arquivo...

`)
    .setColor('#ffaa00')
    .setFooter({ text: ' Sistema de conversão gifzada' })
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
 Arquivo: ${file.name}
 Tamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB
 Tipo: ${tipo.toUpperCase()}
 Status: Convertendo...
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
        content: ` **Arquivo de entrada muito grande!**\n\n` +
                ` **Tamanho:** ${originalSizeMB.toFixed(2)} MB\n` +
                ` **Limite:** ${maxInputSize} MB\n\n` +
                ` **Dica:** Use um arquivo menor como entrada.`,
        embeds: []
      });
      conversaoEscolha.delete(message.channel.id);
      return;
    }

    const { buffer, name, temporarios } = await processFile(file, tipo, percentage);

    // Verificar tamanho do arquivo final antes de enviar
    const fileSizeBytes = buffer.length;
    const fileSizeMB = fileSizeBytes / 1024 / 1024;

    // Limite do Discord: 25MB para usuários normais
    const maxOutputSize = 25; // MB

    if (fileSizeMB > maxOutputSize) {
      await aguardandoMsg.edit({
        content: ` **Arquivo convertido muito grande!**\n\n` +
                ` **Tamanho final:** ${fileSizeMB.toFixed(2)} MB\n` +
                ` **Limite Discord:** ${maxOutputSize} MB\n\n` +
                ` **Dica:** O arquivo aumentou durante a conversão. Tente um vídeo mais curto.`,
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

    // Então enviar o resultado final completamente limpo
    await aguardandoMsg.edit({ 
      content: `${message.author} **Sua conversão está pronta!**`, 
      embeds: [resultEmbed], 
      files: [attachment],
      components: []
    });

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
async function processFile(attachment, type, percentage = null) {
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

      await new Promise((resolve, reject) => {
        ffmpeg(tempInput)
          .toFormat('gif')
          .outputOptions([
            '-vf', 'scale=320:-1:flags=lanczos,fps=15',
            '-t', '8',
            '-pix_fmt', 'rgb24'
          ])
          .on('end', resolve)
          .on('error', reject)
          .save(tempOutput);
      });

      const gif = fs.readFileSync(tempOutput);
      return { buffer: gif, name: `convertido.gif`, temporarios };
    }

    case 'resize-gif': {
      const response = await fetch(url);
      const buffer = await response.buffer();
      const input = `in_${nomeBase}.gif`;
      const output = `out_${nomeBase}.gif`;
      fs.writeFileSync(input, buffer);
      temporarios.push(input, output);

      // Calcular escala baseada na porcentagem (se não fornecida, usar 70% como padrão)
      const optimizationPercentage = percentage || 70;
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

    case 'crop-image': {
      const response = await fetch(attachment.url);
      const buffer = await response.buffer();

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
        const buffer = await response.buffer();

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
      const buffer = await response.buffer();
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
          '-vf', 'scale=480:-1:flags=lanczos,fps=25',
          '-pix_fmt', 'rgb24'
        ])
        .toFormat('gif')
        .on('end', resolve)
        .on('error', reject)
        .save(tempGif);
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

client.login(process.env.TOKEN);
