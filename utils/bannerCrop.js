const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

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
        // Se a imagem for menor que o banner, redimensionar inteligentemente
        let processedImageBuffer = Buffer.from(imageBuffer);
        let finalWidth = metadata.width;
        let finalHeight = metadata.height;
        
        if (metadata.width < BANNER_WIDTH || metadata.height < BANNER_HEIGHT) {
            // Calcular escala para manter proporção
            const scaleWidth = BANNER_WIDTH / metadata.width;
            const scaleHeight = BANNER_HEIGHT / metadata.height;
            const scale = Math.max(scaleWidth, scaleHeight); // Usar a maior escala para garantir que cubra o banner
            
            finalWidth = Math.ceil(metadata.width * scale);
            finalHeight = Math.ceil(metadata.height * scale);
            
            // Detect if it's a GIF first to choose the right resizing method
            const isGif = attachment.name.toLowerCase().endsWith('.gif');
            
            if (isGif) {
                // For GIFs, use gifsicle to preserve animation during resize
                console.log(`Resizing animated GIF from ${metadata.width}x${metadata.height} to ${finalWidth}x${finalHeight}`);
                processedImageBuffer = await resizeGifWithGifsicle(Buffer.from(imageBuffer), finalWidth, finalHeight);
                console.log('GIF resized successfully while preserving animation');
            } else {
                // For static images, use Sharp
                processedImageBuffer = await sharp(Buffer.from(imageBuffer))
                    .resize(finalWidth, finalHeight, {
                        fit: 'fill',
                        kernel: sharp.kernel.lanczos3
                    })
                    .toBuffer();
            }
            
            // Mostrar informação sobre o redimensionamento
            const infoEmbed = new EmbedBuilder()
                .setTitle('📏 **IMAGEM REDIMENSIONADA**')
                .setDescription(`
Sua imagem foi automaticamente redimensionada para permitir a criação do banner:

**Original:** ${metadata.width}x${metadata.height}px
**Redimensionada:** ${finalWidth}x${finalHeight}px
**Banner final:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px

✅ Agora você pode ajustar a posição do corte!
`)
                .setColor('#00ff88')
                .setFooter({ text: 'A qualidade foi mantida usando algoritmo Lanczos3' });
            
            await interaction.editReply({ 
                content: '📏 **Imagem redimensionada automaticamente!**',
                embeds: [infoEmbed] 
            });
        }

        // Detect original file format
        const originalFormat = attachment.name.toLowerCase().endsWith('.gif') ? 'gif' : 
                              attachment.name.toLowerCase().endsWith('.webp') ? 'webp' : 
                              'png';

        // Create crop session
        const sessionId = `banner_${interaction.user.id}_${Date.now()}`;
        const session = {
            userId: interaction.user.id,
            originalWidth: finalWidth,
            originalHeight: finalHeight,
            imageBuffer: processedImageBuffer,
            originalFormat: originalFormat,
            cropX: Math.max(0, Math.floor((finalWidth - BANNER_WIDTH) / 2)),
            cropY: Math.max(0, Math.floor((finalHeight - BANNER_HEIGHT) / 2)),
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
            content: ' **Imagem Original Recebida:**',
            files: [originalImageAttachment]
        });

        // Create embed with information
        const embed = new EmbedBuilder()
            .setColor(0xff6b35)
            .setTitle(' Editor de Banner do Discord')
            .setDescription(
                `** Imagem Original:** ${finalWidth}x${finalHeight}px\n` +
                `** Banner Final:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px\n` +
                `** Zoom:** ${(session.zoomScale * 100).toFixed(0)}%\n\n` +
                `** Posição Atual:** X: ${session.cropX}, Y: ${session.cropY}\n` +
                `** Área Vermelha:** Região que será cortada\n` +
                `** Área Branca:** Imagem original\n\n` +
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
                    .setLabel('+')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(session.zoomScale >= 3.0),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_zoomout_${sessionId}`)
                    .setLabel('-')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(session.zoomScale <= 0.5),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_confirm_${sessionId}`)
                    .setLabel(' Criar Banner')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`banner_crop_cancel_${sessionId}`)
                    .setLabel(' Cancelar')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.editReply({
            content: ' **Sistema Interativo de Banner Ativado!**',
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

// Generate banner preview using Sharp (PNG preview for all formats)
async function generateBannerPreview(session) {
    try {
        // Always use Sharp for preview (PNG) - fast and consistent
        // Final crop will preserve GIF animation separately
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
                      font-size="${Math.max(12, 20 * session.zoomScale)}" font-family="Arial Bold" font-weight="bold">
                      Banner ${BANNER_WIDTH}x${BANNER_HEIGHT}
                </text>
                <text x="10" y="${Math.max(15, 25 * session.zoomScale)}" 
                      fill="white" stroke="black" stroke-width="1" 
                      font-size="${Math.max(10, 16 * session.zoomScale)}" font-family="Arial Bold" font-weight="bold">
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
                <text x="200" y="70" text-anchor="middle" font-size="18" font-family="Arial Bold">
                    Banner Crop Preview
                </text>
                <text x="200" y="100" text-anchor="middle" font-size="14" font-family="Arial Bold">
                    Image: ${session.originalWidth}x${session.originalHeight}px
                </text>
                <text x="200" y="125" text-anchor="middle" font-size="14" font-family="Arial Bold">
                    Banner: ${BANNER_WIDTH}x${BANNER_HEIGHT}px
                </text>
                <text x="200" y="150" text-anchor="middle" font-size="14" font-family="Arial Bold">
                    Position: X:${session.cropX} Y:${session.cropY}
                </text>
            </svg>
        `;
        return Buffer.from(simpleSvg);
    }
}

// Resize GIF while preserving animation using gifsicle
async function resizeGifWithGifsicle(imageBuffer, targetWidth, targetHeight) {
    const tempDir = path.join(__dirname, '..', 'temp');
    const inputPath = path.join(tempDir, `resize_input_${Date.now()}.gif`);
    const outputPath = path.join(tempDir, `resize_output_${Date.now()}.gif`);
    
    try {
        // Create temp directory if it doesn't exist
        try {
            await fs.mkdir(tempDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
        
        // Write input GIF to temp file
        await fs.writeFile(inputPath, imageBuffer);
        console.log(`Gifsicle resize input written: ${inputPath}`);
        
        // Check input frame count
        try {
            const inputInfoCommand = `gifsicle --info "${inputPath}"`;
            const { stdout: inputInfo } = await execPromise(inputInfoCommand);
            console.log(`Resize input GIF info: ${inputInfo}`);
            
            const inputImageMatches = inputInfo.match(/\+ image #/g) || [];
            const inputFrameMatches = inputInfo.match(/(\d+) images?/g) || [];
            
            let inputFrameCount = inputImageMatches.length;
            if (inputFrameCount === 0 && inputFrameMatches.length > 0) {
                const match = inputFrameMatches[0].match(/(\d+) images?/);
                if (match) {
                    inputFrameCount = parseInt(match[1]);
                }
            }
            
            console.log(`Input GIF for resize has ${inputFrameCount} frames`);
        } catch (infoError) {
            console.log('Could not get input GIF info for resize, proceeding:', infoError.message);
        }
        
        // Use gifsicle to resize while preserving all frames
        const resizeCommand = `gifsicle --resize ${targetWidth}x${targetHeight} "${inputPath}" -o "${outputPath}"`;
        console.log(`Executing gifsicle resize command: ${resizeCommand}`);
        
        try {
            const { stdout, stderr } = await execPromise(resizeCommand, { timeout: 45000 });
            if (stderr && stderr.trim()) {
                console.log(`Resize gifsicle stderr: ${stderr}`);
            }
            if (stdout && stdout.trim()) {
                console.log(`Resize gifsicle stdout: ${stdout}`);
            }
            console.log('Gifsicle resize executed successfully');
        } catch (execError) {
            console.error('Gifsicle resize execution error:', execError);
            throw new Error(`Falha no redimensionamento do GIF: ${execError.message}`);
        }
        
        // Verify output file exists and has content
        try {
            const stats = await fs.stat(outputPath);
            if (stats.size === 0) {
                throw new Error('Arquivo de saída do redimensionamento está vazio');
            }
            console.log(`Gifsicle resize created output file: ${outputPath} (${stats.size} bytes)`);
        } catch (statError) {
            console.error('Error verifying resize output file:', statError);
            throw new Error(`Arquivo de redimensionamento não foi criado: ${statError.message}`);
        }
        
        // Check output frame count
        try {
            const outputInfoCommand = `gifsicle --info "${outputPath}"`;
            const { stdout: outputInfo } = await execPromise(outputInfoCommand);
            console.log(`Resize output GIF info: ${outputInfo}`);
            
            const outputImageMatches = outputInfo.match(/\+ image #/g) || [];
            const outputFrameMatches = outputInfo.match(/(\d+) images?/g) || [];
            
            let outputFrameCount = outputImageMatches.length;
            if (outputFrameCount === 0 && outputFrameMatches.length > 0) {
                const match = outputFrameMatches[0].match(/(\d+) images?/);
                if (match) {
                    outputFrameCount = parseInt(match[1]);
                }
            }
            
            console.log(`Output GIF after resize has ${outputFrameCount} frames`);
        } catch (infoError) {
            console.log('Could not get output GIF info after resize:', infoError.message);
        }
        
        // Read the resized GIF
        const outputBuffer = await fs.readFile(outputPath);
        console.log(`Gifsicle resize successful, output size: ${outputBuffer.length} bytes`);
        
        // Cleanup temp files
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        
        return outputBuffer;
    } catch (error) {
        console.error('Gifsicle resize processing error:', error);
        // Cleanup on any error
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        throw error;
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
            flags: 1 << 6
        });
        return true;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Apenas quem iniciou pode controlar esta sessão!',
            flags: 1 << 6
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
                .setTitle(' Editor de Banner do Discord')
                .setDescription(
                    `** Imagem Original:** ${session.originalWidth}x${session.originalHeight}px\n` +
                    `** Banner Final:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px\n` +
                    `** Zoom:** ${(session.zoomScale * 100).toFixed(0)}%\n\n` +
                    `** Posição Atual:** X: ${session.cropX}, Y: ${session.cropY}\n` +
                    `** Área Vermelha:** Região que será cortada\n` +
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
                        .setLabel('+')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(session.zoomScale >= 3.0),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_zoomout_${sessionId}`)
                        .setLabel('-')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(session.zoomScale <= 0.5),
                    new ButtonBuilder()
                        .setCustomId(`banner_crop_confirm_${sessionId}`)
                        .setLabel(' Criar Banner')
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
            flags: 1 << 6
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
        
        // Preserve original format with special handling for GIFs
        let croppedBuffer, fileExtension;
        if (session.originalFormat === 'gif') {
            // For GIFs, ALWAYS use gifsicle or FFmpeg to preserve animation
            try {
                console.log('Processing GIF with gifsicle to preserve animation...');
                croppedBuffer = await processGifWithGifsicle(session.imageBuffer, adjustedCropX, adjustedCropY, actualWidth, actualHeight);
                fileExtension = 'gif';
                console.log('GIF processing completed successfully with gifsicle');
            } catch (gifsicleError) {
                console.error('Gifsicle GIF processing failed, trying FFmpeg:', gifsicleError);
                try {
                    console.log('Attempting FFmpeg GIF processing...');
                    croppedBuffer = await processGifWithFFmpeg(session.imageBuffer, adjustedCropX, adjustedCropY, actualWidth, actualHeight);
                    fileExtension = 'gif';
                    console.log('GIF processing completed successfully with FFmpeg');
                } catch (ffmpegError) {
                    console.error('Both gifsicle and FFmpeg failed. This should not happen for GIF processing:', ffmpegError);
                    throw new Error('Falha ao processar GIF animado. Tente novamente ou use uma imagem estática.');
                }
            }
        } else {
            // For static images, use Sharp
            let sharpProcessor = sharp(session.imageBuffer)
                .extract({
                    left: adjustedCropX,
                    top: adjustedCropY,
                    width: actualWidth,
                    height: actualHeight
                })
                .resize(BANNER_WIDTH, BANNER_HEIGHT);

            if (session.originalFormat === 'webp') {
                croppedBuffer = await sharpProcessor.webp().toBuffer();
                fileExtension = 'webp';
            } else {
                croppedBuffer = await sharpProcessor.png().toBuffer();
                fileExtension = 'png';
            }
        }

        const finalAttachment = new AttachmentBuilder(croppedBuffer, { 
            name: `banner_discord_${adjustedCropX}_${adjustedCropY}_zoom${(session.zoomScale * 100).toFixed(0)}.${fileExtension}` 
        });

        // Final embed
        const finalEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(' Banner do Discord Criado!')
            .setDescription(
                `Sua imagem foi cortada no formato banner do Discord!\n\n` +
                `** Dimensões:** ${BANNER_WIDTH}x${BANNER_HEIGHT}px\n` +
                `** Posição do Corte:** X: ${adjustedCropX}, Y: ${adjustedCropY}\n` +
                `** Zoom Aplicado:** ${(session.zoomScale * 100).toFixed(0)}%\n` +
                `** Área Cortada:** ${actualWidth}x${actualHeight}px\n` +
                `** Formato:** ${session.originalFormat.toUpperCase()}\n` +
                `** Nome:** banner_discord_${adjustedCropX}_${adjustedCropY}_zoom${(session.zoomScale * 100).toFixed(0)}.${fileExtension}`
            )
            .setImage('attachment://' + finalAttachment.name)
            .setTimestamp()
            .setFooter({ 
                text: 'Banner pronto para usar no Discord!' 
            });

        await interaction.editReply({
            content: ' **Seu banner está pronto!**',
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

// Process GIF with gifsicle to preserve animation (preferred method)
async function processGifWithGifsicle(imageBuffer, cropX, cropY, cropWidth, cropHeight) {
    const tempDir = path.join(__dirname, '..', 'temp');
    const inputPath = path.join(tempDir, `gifsicle_input_${Date.now()}.gif`);
    const outputPath = path.join(tempDir, `gifsicle_output_${Date.now()}.gif`);
    
    try {
        // Create temp directory if it doesn't exist
        try {
            await fs.mkdir(tempDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
        
        // Write input GIF to temp file
        await fs.writeFile(inputPath, imageBuffer);
        console.log(`Gifsicle input written: ${inputPath}`);
        
        // First check the input GIF frame count
        try {
            const inputInfoCommand = `gifsicle --info "${inputPath}"`;
            const { stdout: inputInfo } = await execPromise(inputInfoCommand);
            console.log(`Input GIF info: ${inputInfo}`);
            
            const inputImageMatches = inputInfo.match(/\+ image #/g) || [];
            const inputFrameMatches = inputInfo.match(/(\d+) images?/g) || [];
            
            let inputFrameCount = inputImageMatches.length;
            if (inputFrameCount === 0 && inputFrameMatches.length > 0) {
                const match = inputFrameMatches[0].match(/(\d+) images?/);
                if (match) {
                    inputFrameCount = parseInt(match[1]);
                }
            }
            
            console.log(`Input GIF has ${inputFrameCount} frames`);
        } catch (infoError) {
            console.log('Could not get input GIF info, proceeding with crop:', infoError.message);
        }
        
        // Use gifsicle with frame preservation and optimized settings for animated GIFs
        const processCommand = `gifsicle --no-warnings --crop ${cropX},${cropY}+${cropWidth}x${cropHeight} --resize ${BANNER_WIDTH}x${BANNER_HEIGHT} --colors=256 "${inputPath}" -o "${outputPath}"`;
        console.log(`Executing frame-preserving gifsicle command: ${processCommand}`);
        
        try {
            const { stdout, stderr } = await execPromise(processCommand, { timeout: 45000 });
            if (stderr && stderr.trim()) {
                console.log(`Gifsicle stderr: ${stderr}`);
            }
            if (stdout && stdout.trim()) {
                console.log(`Gifsicle stdout: ${stdout}`);
            }
            console.log('Gifsicle command executed successfully with animation preservation');
        } catch (execError) {
            console.error('Gifsicle execution error:', execError);
            throw new Error(`Falha na execução do gifsicle: ${execError.message}`);
        }
        
        // Verify output file exists and has content
        try {
            const stats = await fs.stat(outputPath);
            if (stats.size === 0) {
                console.log('Output file is empty, trying fallback method...');
                // Try ultra-simple command as fallback to preserve all frames
                const fallbackCommand = `gifsicle "${inputPath}" --crop ${cropX},${cropY}+${cropWidth}x${cropHeight} --resize ${BANNER_WIDTH}x${BANNER_HEIGHT} -o "${outputPath}"`;
                console.log(`Executing ultra-simple fallback gifsicle command: ${fallbackCommand}`);
                await execPromise(fallbackCommand, { timeout: 45000 });
                
                const fallbackStats = await fs.stat(outputPath);
                if (fallbackStats.size === 0) {
                    throw new Error('Arquivo de saída ainda está vazio após fallback');
                }
                console.log(`Fallback gifsicle created output file: ${outputPath} (${fallbackStats.size} bytes)`);
            } else {
                console.log(`Gifsicle created output file: ${outputPath} (${stats.size} bytes)`);
            }
        } catch (statError) {
            console.error('Error verifying output file:', statError);
            throw new Error(`Arquivo de saída não foi criado: ${statError.message}`);
        }
        
        // Verify frame count before returning
        try {
            const frameCheckCommand = `gifsicle --info "${outputPath}"`;
            const { stdout: frameInfo } = await execPromise(frameCheckCommand);
            console.log(`Frame info for output GIF: ${frameInfo}`);
            
            // Check if output has animation indicators
            const imageMatches = frameInfo.match(/\+ image #/g) || [];
            const frameMatches = frameInfo.match(/(\d+) images?/g) || [];
            const delayMatches = frameInfo.match(/delay \d+\.\d+s/g) || [];
            const disposalMatches = frameInfo.match(/disposal/g) || [];
            
            let frameCount = imageMatches.length;
            
            // If no + image # found, try to extract from "X images" format
            if (frameCount === 0 && frameMatches.length > 0) {
                const match = frameMatches[0].match(/(\d+) images?/);
                if (match) {
                    frameCount = parseInt(match[1]);
                }
            }
            
            console.log(`Output GIF analysis - Images: ${frameCount}, Delays: ${delayMatches.length}, Disposal: ${disposalMatches.length}`);
            
            // If we have delay information OR disposal info, it's an animated GIF (even if single frame)
            // Some GIFs have animation data but appear as "1 image" in gifsicle info
            const hasAnimationData = delayMatches.length > 0 || disposalMatches.length > 0;
            
            if (hasAnimationData) {
                console.log('GIF has animation data (delay/disposal), treating as animated GIF');
            } else {
                console.log('No animation indicators found, switching to FFmpeg for better processing...');
                throw new Error('No animation data detected, switching to FFmpeg');
            }
        } catch (frameCheckError) {
            console.log('Frame check failed or uncertain animation status, will use FFmpeg fallback:', frameCheckError.message);
            throw frameCheckError;
        }
        
        // Read the processed GIF
        const outputBuffer = await fs.readFile(outputPath);
        console.log(`Gifsicle processing successful, output size: ${outputBuffer.length} bytes with preserved animation`);
        
        // Cleanup temp files
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        
        return outputBuffer;
    } catch (error) {
        console.error('Gifsicle processing error:', error);
        // Cleanup on any error
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        throw error;
    }
}

// Process GIF with FFmpeg to preserve animation
async function processGifWithFFmpeg(imageBuffer, cropX, cropY, cropWidth, cropHeight) {
    const tempDir = path.join(__dirname, '..', 'temp');
    const inputPath = path.join(tempDir, `input_${Date.now()}.gif`);
    const outputPath = path.join(tempDir, `output_${Date.now()}.gif`);
    
    try {
        // Create temp directory if it doesn't exist
        try {
            await fs.mkdir(tempDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
        
        // Write input GIF to temp file
        await fs.writeFile(inputPath, imageBuffer);
        
        // Use FFmpeg to crop and resize the GIF preserving all frames with better settings
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .inputOptions([
                    '-f', 'gif'
                ])
                .outputOptions([
                    '-f', 'gif',
                    `-vf crop=${cropWidth}:${cropHeight}:${cropX}:${cropY},scale=${BANNER_WIDTH}:${BANNER_HEIGHT}:flags=lanczos`,
                    '-loop', '0',
                    '-vsync', '0'
                ])
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log('FFmpeg GIF processing started:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('FFmpeg progress:', progress.percent ? Math.round(progress.percent) + '%' : 'processing...');
                })
                .on('end', async () => {
                    try {
                        console.log('FFmpeg GIF processing completed successfully');
                        const outputBuffer = await fs.readFile(outputPath);
                        // Cleanup temp files
                        await fs.unlink(inputPath).catch(() => {});
                        await fs.unlink(outputPath).catch(() => {});
                        resolve(outputBuffer);
                    } catch (error) {
                        console.error('Error reading processed GIF:', error);
                        reject(error);
                    }
                })
                .on('error', async (error) => {
                    console.error('FFmpeg GIF processing error:', error);
                    // Cleanup temp files on error
                    await fs.unlink(inputPath).catch(() => {});
                    await fs.unlink(outputPath).catch(() => {});
                    reject(error);
                })
                .run();
        });
    } catch (error) {
        // Cleanup on any error
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        throw error;
    }
}

module.exports = {
    createBannerCropSession,
    handleBannerCropButton,
    bannerCropSessions
};
