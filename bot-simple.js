const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder } = require('discord.js');
const { createBannerCropSession, handleBannerCropButton } = require('./utils/bannerCrop');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Store conversion choices
const conversaoEscolha = new Map();

client.once('ready', () => {
    console.log('🚀 Bot do Discord conectado!');
    console.log(`📊 Bot está em ${client.guilds.cache.size} servidores`);
    console.log(`🔗 Link de convite: https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`);
});

// Handle button interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const { customId } = interaction;

    // Handle banner crop buttons
    if (customId.startsWith('banner_crop_')) {
        const handled = await handleBannerCropButton(interaction);
        if (handled) return;
    }

    // Handle conversion selection
    if (customId === 'abrir_conversor') {
        const embed = new EmbedBuilder()
            .setTitle('🎬 CONVERSOR GIFZADA')
            .setDescription('Selecione o tipo de conversão desejada:')
            .setColor('#870CFF');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('conversion_select')
            .setPlaceholder('🎯 Escolha o tipo de conversão')
            .addOptions([
                {
                    label: 'Banner Discord',
                    description: 'Corta para formato 734x293px com sistema interativo',
                    value: 'discord_banner',
                    emoji: '🖼️'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: false
        });
    }
});

// Handle select menu interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;

    const { customId, values, channel } = interaction;

    if (customId === 'conversion_select' && values[0] === 'discord_banner') {
        conversaoEscolha.set(channel.id, 'discord-banner');

        const embed = new EmbedBuilder()
            .setTitle('✅ BANNER DISCORD SELECIONADO')
            .setDescription('📤 **Envie sua imagem** para criar um banner interativo!\n\n' +
                          '🎯 **Sistema Interativo:** Você poderá escolher exatamente onde cortar\n' +
                          '📐 **Formato Final:** 734x293px (banner do Discord)\n\n' +
                          '💡 **Dica:** Arraste e solte sua imagem no chat!')
            .setColor('#8804fc');

        await interaction.reply({ embeds: [embed], ephemeral: false });
    }
});

// Handle messages with attachments
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const tipoData = conversaoEscolha.get(message.channel.id);
    const file = message.attachments.first();

    if (!tipoData || !file) return;

    // Check if it's discord-banner type
    if (tipoData === 'discord-banner') {
        // Verify file is an image
        if (!file.contentType?.startsWith('image/')) {
            await message.reply('❌ Por favor, envie apenas arquivos de imagem!');
            return;
        }

        // Check file size (max 8MB)
        if (file.size > 8 * 1024 * 1024) {
            await message.reply('❌ A imagem é muito grande! Máximo 8MB.');
            return;
        }

        // Create loading message
        const loadingEmbed = new EmbedBuilder()
            .setTitle('🔄 Carregando Sistema Interativo')
            .setDescription('Processando sua imagem e preparando o editor de banner...')
            .setColor('#ffaa00');

        const loadingMsg = await message.channel.send({ embeds: [loadingEmbed] });

        // Create interaction-like object for banner crop session
        const interactionObject = {
            editReply: async (options) => {
                await loadingMsg.edit(options);
            },
            user: message.author
        };

        // Start interactive banner crop session
        await createBannerCropSession(interactionObject, file);
        conversaoEscolha.delete(message.channel.id);
    }
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN não encontrado no ambiente!');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Falha no login:', error);
    process.exit(1);
});