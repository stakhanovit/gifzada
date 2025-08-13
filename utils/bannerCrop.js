const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');

// Store active banner crop sessions
const bannerCropSessions = new Map();

// Discord banner dimensions
const BANNER_WIDTH = 734;
const BANNER_HEIGHT = 293;

// Create interactive banner crop session
async function createBannerCropSession(interaction, attachment) {
    try {
        // Download and process the image
        const response = await fetch(attachment.url);
        const imageBuffer = await response.arrayBuffer();
        const image = sharp(Buffer.from(imageBuffer));
        const metadata = await image.metadata();

        // Check if image is large enough for banner
        if (metadata.width < BANNER_WIDTH || metadata.height < BANNER_HEIGHT) {
            await interaction.editReply({
                content: `❌ A imagem é muito pequena para criar um banner.\n` +
                        `**Tamanho mínimo:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px\n` +
                        `**Sua imagem:** ${metadata.width}x${metadata.height}px`,
                components: []
            });
            return;
        }

        // Create crop session
        const sessionId = `banner_${interaction.user.id}_${Date.now()}`;
        const session = {
            userId: interaction.user.id,
            originalWidth: metadata.width,
            originalHeight: metadata.height,
            imageBuffer: Buffer.from(imageBuffer),
            cropX: Math.max(0, Math.floor((metadata.width - BANNER_WIDTH) / 2)),
            cropY: Math.max(0, Math.floor((metadata.height - BANNER_HEIGHT) / 2)),
            step: 25, // Pixels por movimento
            zoomScale: 1.0, // Escala de zoom (1.0 = tamanho normal)
            attachment: attachment
        };

        bannerCropSessions.set(sessionId, session);

        // Send original image first, outside of embed
        const originalImageAttachment = new AttachmentBuilder(session.imageBuffer, { 
            name: 'original_image.png' 
        });
        
        // Generate initial preview
        const previewBuffer = await generateBannerPreview(session);
        const previewAttachment = new AttachmentBuilder(previewBuffer, { name: 'banner_preview.png' });

        // Send original image first
        await interaction.editReply({
            content: '📸 **Imagem Original Recebida:**',
            files: [originalImageAttachment]
        });

        // Create embed with information
        const embed = new EmbedBuilder()
            .setColor(0xff6b35)
            .setTitle('🖼️ Editor de Banner do Discord')
            .setDescription(
                `**📐 Imagem Original:** ${metadata.width}x${metadata.height}px\n` +
                `**🎯 Banner Final:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px\n` +
                `**🔍 Zoom:** ${(session.zoomScale * 100).toFixed(0)}%\n\n` +
                `**📍 Posição Atual:** X: ${session.cropX}, Y: ${session.cropY}\n` +
                `**🔴 Área Vermelha:** Região que será cortada\n` +
                `**⬜ Área Branca:** Imagem original\n\n` +
                `Use as setas para posicionar e os botões +/- para zoom.`
            )
            .setImage('attachment://banner_preview.png')
            .setFooter({ 
                text: 'Ajuste a posição e o zoom da área vermelha e confirme quando estiver satisfeito' 
            });

        // Create control buttons with zoom-adjusted boundaries
        const actualWidth = Math.round(BANNER_WIDTH * session.zoomScale);
        const actualHeight = Math.round(BANNER_HEIGHT * session.zoomScale);
        
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`banner_crop_up_${sessionId}`)
                    .setLabel('↑')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(session.cropY <= 0),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_down_${sessionId}`)
                    .setLabel('↓')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(session.cropY >= metadata.height - actualHeight),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_left_${sessionId}`)
                    .setLabel('←')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(session.cropX <= 0),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_right_${sessionId}`)
                    .setLabel('→')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(session.cropX >= metadata.width - actualWidth)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`banner_crop_zoomin_${sessionId}`)
                    .setLabel('🔍+')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(session.zoomScale >= 3.0),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_zoomout_${sessionId}`)
                    .setLabel('🔍-')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(session.zoomScale <= 0.5),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_confirm_${sessionId}`)
                    .setLabel('✅ Criar Banner')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_cancel_${sessionId}`)
                    .setLabel('❌ Cancelar')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.editReply({
            content: '🎨 **Sistema Interativo de Banner Ativado!**',
            embeds: [embed],
            files: [previewAttachment],
            components: [row1, row2]
        });

        // Auto-cleanup session after 10 minutes
        setTimeout(() => {
            bannerCropSessions.delete(sessionId);
        }, 10 * 60 * 1000);

        return sessionId;

    } catch (error) {
        console.error('Erro ao criar sessão de banner:', error);
        await interaction.editReply({
            content: '❌ Erro ao processar a imagem. Tente novamente com uma imagem diferente.',
            components: []
        });
    }
}

// Generate banner preview using Sharp (without canvas)
async function generateBannerPreview(session) {
    try {
        // Create a copy of the original image
        let image = sharp(session.imageBuffer);
        
        // Get image metadata to ensure we have dimensions
        const metadata = await image.metadata();
        const { width, height } = metadata;
        
        // Create an overlay with red border for the crop area (affected by zoom)  
        // LÓGICA CORRIGIDA: zoom maior = área maior na imagem original
        const overlayWidth = Math.round(BANNER_WIDTH * session.zoomScale);
        const overlayHeight = Math.round(BANNER_HEIGHT * session.zoomScale);
        
        // Create a red border overlay
        const redBorderSvg = `
            <svg width="${overlayWidth}" height="${overlayHeight}">
                <rect x="0" y="0" width="${overlayWidth}" height="${overlayHeight}" 
                      fill="rgba(255,0,0,0.3)" stroke="red" stroke-width="4"/>
                <text x="${overlayWidth/2}" y="${overlayHeight/2}" 
                      text-anchor="middle" dominant-baseline="middle" 
                      fill="white" stroke="black" stroke-width="1" 
                      font-size="${Math.max(12, 20 * session.zoomScale)}" font-family="Arial" font-weight="bold">
                      Banner ${BANNER_WIDTH}x${BANNER_HEIGHT}
                </text>
                <text x="10" y="${Math.max(15, 25 * session.zoomScale)}" 
                      fill="white" stroke="black" stroke-width="1" 
                      font-size="${Math.max(10, 16 * session.zoomScale)}" font-family="Arial" font-weight="bold">
                      Área: ${overlayWidth}x${overlayHeight}px | Zoom: ${(session.zoomScale * 100).toFixed(0)}%
                </text>
            </svg>
        `;
        
        // Create overlay buffer
        const overlayBuffer = Buffer.from(redBorderSvg);
        
        // Composite the overlay onto the original image
        const result = await image
            .composite([{
                input: overlayBuffer,
                top: session.cropY,
                left: session.cropX
            }])
            .png()
            .toBuffer();
            
        return result;
    } catch (error) {
        console.error('Error generating preview:', error);
        // Fallback: return a simple text-based preview
        const simpleSvg = `
            <svg width="400" height="200">
                <rect width="400" height="200" fill="white" stroke="black" stroke-width="2"/>
                <text x="200" y="70" text-anchor="middle" font-size="18" font-family="Arial">
                    Banner Crop Preview
                </text>
                <text x="200" y="100" text-anchor="middle" font-size="14" font-family="Arial">
                    Image: ${session.originalWidth}x${session.originalHeight}px
                </text>
                <text x="200" y="125" text-anchor="middle" font-size="14" font-family="Arial">
                    Banner: ${BANNER_WIDTH}x${BANNER_HEIGHT}px
                </text>
                <text x="200" y="150" text-anchor="middle" font-size="14" font-family="Arial">
                    Position: X:${session.cropX} Y:${session.cropY}
                </text>
            </svg>
        `;
        return Buffer.from(simpleSvg);
    }
}

// Handle banner crop button interactions
async function handleBannerCropButton(interaction) {
    const customId = interaction.customId;
    
    if (!customId.startsWith('banner_crop_')) {
        return false;
    }

    const parts = customId.split('_');
    const action = parts[2]; // up, down, left, right, confirm, cancel
    const sessionId = parts.slice(3).join('_');
    
    const session = bannerCropSessions.get(sessionId);
    if (!session) {
        await interaction.reply({
            content: '❌ Sessão expirada! Use o conversor novamente para criar um novo banner.',
            ephemeral: true
        });
        return true;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Apenas quem iniciou pode controlar esta sessão!',
            ephemeral: true
        });
        return true;
    }

    await interaction.deferUpdate();

    try {
        if (action === 'confirm') {
            await performBannerCrop(interaction, session, sessionId);
        } else if (action === 'cancel') {
            bannerCropSessions.delete(sessionId);
            await interaction.editReply({
                content: '❌ Criação de banner cancelada.',
                embeds: [],
                files: [],
                components: []
            });
        } else {
            // Handle movement or zoom
            if (['up', 'down', 'left', 'right'].includes(action)) {
                moveBannerCropArea(session, action);
            } else if (action === 'zoomin') {
                session.zoomScale = Math.min(3.0, session.zoomScale + 0.2);
                // Adjust crop position if it goes out of bounds after zoom
                const actualWidth = Math.round(BANNER_WIDTH * session.zoomScale);
                const actualHeight = Math.round(BANNER_HEIGHT * session.zoomScale);
                session.cropX = Math.min(session.cropX, Math.max(0, session.originalWidth - actualWidth));
                session.cropY = Math.min(session.cropY, Math.max(0, session.originalHeight - actualHeight));
            } else if (action === 'zoomout') {
                session.zoomScale = Math.max(0.5, session.zoomScale - 0.2);
                // Adjust crop position if it goes out of bounds after zoom
                const actualWidth = Math.round(BANNER_WIDTH * session.zoomScale);
                const actualHeight = Math.round(BANNER_HEIGHT * session.zoomScale);
                session.cropX = Math.min(session.cropX, Math.max(0, session.originalWidth - actualWidth));
                session.cropY = Math.min(session.cropY, Math.max(0, session.originalHeight - actualHeight));
            }
            
            // Generate new preview
            const previewBuffer = await generateBannerPreview(session);
            const previewAttachment = new AttachmentBuilder(previewBuffer, { name: 'banner_preview.png' });

            // Update embed
            const embed = new EmbedBuilder()
                .setColor(0xff6b35)
                .setTitle('🖼️ Editor de Banner do Discord')
                .setDescription(
                    `**📐 Imagem Original:** ${session.originalWidth}x${session.originalHeight}px\n` +
                    `**🎯 Banner Final:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px\n` +
                    `**🔍 Zoom:** ${(session.zoomScale * 100).toFixed(0)}%\n\n` +
                    `**📍 Posição Atual:** X: ${session.cropX}, Y: ${session.cropY}\n` +
                    `**🔴 Área Vermelha:** Região que será cortada\n` +
                    `**⬜ Área Branca:** Imagem original\n\n` +
                    `Use as setas para posicionar e os botões +/- para zoom.`
                )
                .setImage('attachment://banner_preview.png')
                .setFooter({ 
                    text: 'Ajuste a posição e o zoom da área vermelha e confirme quando estiver satisfeito' 
                });

            // Update button states with zoom-adjusted boundaries
            const actualWidth = Math.round(BANNER_WIDTH * session.zoomScale);
            const actualHeight = Math.round(BANNER_HEIGHT * session.zoomScale);
            
            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_up_${sessionId}`)
                        .setLabel('↑')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(session.cropY <= 0),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_down_${sessionId}`)
                        .setLabel('↓')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(session.cropY >= session.originalHeight - actualHeight),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_left_${sessionId}`)
                        .setLabel('←')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(session.cropX <= 0),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_right_${sessionId}`)
                        .setLabel('→')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(session.cropX >= session.originalWidth - actualWidth)
                );

            const row2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_zoomin_${sessionId}`)
                        .setLabel('🔍+')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(session.zoomScale >= 3.0),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_zoomout_${sessionId}`)
                        .setLabel('🔍-')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(session.zoomScale <= 0.5),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_confirm_${sessionId}`)
                        .setLabel('✅ Criar Banner')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_cancel_${sessionId}`)
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.editReply({
                embeds: [embed],
                files: [previewAttachment],
                components: [row1, row2]
            });
        }
    } catch (error) {
        console.error('Erro ao processar botão de banner:', error);
        await interaction.followUp({
            content: '❌ Erro ao processar a ação. Tente novamente.',
            ephemeral: true
        });
    }

    return true;
}

// Move banner crop area
function moveBannerCropArea(session, direction) {
    // Calculate actual crop dimensions based on zoom scale
    // LÓGICA CORRETA: zoom maior = área maior cortada da imagem original
    const actualWidth = Math.round(BANNER_WIDTH * session.zoomScale);
    const actualHeight = Math.round(BANNER_HEIGHT * session.zoomScale);
    
    const maxX = Math.max(0, session.originalWidth - actualWidth);
    const maxY = Math.max(0, session.originalHeight - actualHeight);

    switch (direction) {
        case 'up':
            session.cropY = Math.max(0, session.cropY - session.step);
            break;
        case 'down':
            session.cropY = Math.min(maxY, session.cropY + session.step);
            break;
        case 'left':
            session.cropX = Math.max(0, session.cropX - session.step);
            break;
        case 'right':
            session.cropX = Math.min(maxX, session.cropX + session.step);
            break;
    }
}

// Perform final banner crop
async function performBannerCrop(interaction, session, sessionId) {
    try {
        // Calculate actual crop dimensions based on zoom scale
        // LÓGICA CORRETA: zoom maior = área maior cortada da imagem original
        const actualWidth = Math.round(BANNER_WIDTH * session.zoomScale);
        const actualHeight = Math.round(BANNER_HEIGHT * session.zoomScale);
        
        // Ensure crop area doesn't exceed image boundaries
        const maxX = Math.max(0, session.originalWidth - actualWidth);
        const maxY = Math.max(0, session.originalHeight - actualHeight);
        const adjustedCropX = Math.min(session.cropX, maxX);
        const adjustedCropY = Math.min(session.cropY, maxY);
        
        // Process the crop with Sharp using zoom-adjusted dimensions
        const croppedBuffer = await sharp(session.imageBuffer)
            .extract({
                left: adjustedCropX,
                top: adjustedCropY,
                width: actualWidth,
                height: actualHeight
            })
            .resize(BANNER_WIDTH, BANNER_HEIGHT)
            .png()
            .toBuffer();

        const finalAttachment = new AttachmentBuilder(croppedBuffer, { 
            name: `banner_discord_${adjustedCropX}_${adjustedCropY}_zoom${(session.zoomScale * 100).toFixed(0)}.png` 
        });

        // Final embed
        const finalEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Banner do Discord Criado!')
            .setDescription(
                `Sua imagem foi cortada no formato banner do Discord!\n\n` +
                `**📐 Dimensões:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px\n` +
                `**📍 Posição do Corte:** X: ${adjustedCropX}, Y: ${adjustedCropY}\n` +
                `**🔍 Zoom Aplicado:** ${(session.zoomScale * 100).toFixed(0)}%\n` +
                `**📏 Área Cortada:** ${actualWidth}x${actualHeight}px\n` +
                `**📁 Nome:** banner_discord_${adjustedCropX}_${adjustedCropY}_zoom${(session.zoomScale * 100).toFixed(0)}.png`
            )
            .setImage('attachment://' + finalAttachment.name)
            .setTimestamp()
            .setFooter({ 
                text: 'Banner pronto para usar no Discord!' 
            });

        await interaction.editReply({
            content: '🎉 **Seu banner está pronto!**',
            embeds: [finalEmbed],
            files: [finalAttachment],
            components: []
        });

        // Clean up session
        bannerCropSessions.delete(sessionId);

    } catch (error) {
        console.error('Erro ao criar banner final:', error);
        await interaction.editReply({
            content: '❌ Erro ao gerar o banner final. Tente novamente.',
            embeds: [],
            files: [],
            components: []
        });
    }
}

module.exports = {
    createBannerCropSession,
    handleBannerCropButton,
    bannerCropSessions
};
