# Overview

This is a Discord bot application built with Node.js that provides multimedia processing, user interaction, and database management capabilities. The bot appears to handle various Discord events, process media files (images, videos, GIFs), integrate with external APIs like YouTube, and maintain user data in a PostgreSQL database. It includes features for scheduled tasks, web server functionality, and custom font rendering for image generation.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## GIF Frame Preservation Root Cause Fix (2025-08-13)
- ✅ Fixed critical issue where animated GIFs lost all frames except the first during initial processing
- ✅ Identified root cause: Sharp library was destroying animation when resizing small images
- ✅ Modified createBannerCropSession to detect GIF format before any processing
- ✅ Added resizeGifWithGifsicle function to preserve all frames during initial resize operations
- ✅ Now GIFs maintain full animation (18+ frames) from upload through final crop output
- ✅ Enhanced frame counting and verification throughout the entire pipeline
- ✅ Reverted preview to efficient PNG format while ensuring final result preserves all GIF frames
- ✅ Comprehensive frame tracking and logging for debugging animation preservation

## GIF Animation Preservation with FFmpeg Processing (2025-08-13)
- ✅ Fixed Discord banner converter to preserve original GIF format instead of converting to PNG
- ✅ Added format detection logic for GIF, WebP, and PNG files in utils/bannerCrop.js
- ✅ Updated commands/banner.js to maintain original file formats during processing
- ✅ **Implemented FFmpeg processing for GIFs to preserve animation during crop/resize operations**
- ✅ **Added specialized processGifWithFFmpeg functions for both banner modules**
- ✅ **Implemented gifsicle as primary GIF processor with FFmpeg as fallback for optimal animation preservation**
- ✅ **Used FFmpeg with lanczos scaling and gif optimization flags for high-quality results**
- ✅ **Created temp file management system with automatic cleanup**
- ✅ Enhanced Sharp processing pipeline to use appropriate output format (.gif(), .webp(), .png())
- ✅ Modified filename generation to use correct file extensions based on original format
- ✅ Updated embed descriptions to show preserved format information
- ✅ Maintained all existing functionality while preserving format integrity
- ✅ **GIF banners now maintain full animation and frame timing instead of losing motion**

## Ephemeral Flag Corrections (2025-08-13)
- ✅ Fixed all deprecated ephemeral boolean usage throughout the codebase
- ✅ Replaced ephemeral: true/false with proper Discord flags: 1 << 6 for ephemeral messages
- ✅ Updated interaction replies, deferred replies, and followUp messages in index.js
- ✅ Corrected banner crop utility ephemeral flags in utils/bannerCrop.js
- ✅ Eliminated all console warnings related to ephemeral deprecation
- ✅ Maintained proper message visibility behavior while using updated syntax
- ✅ Enhanced code compliance with discord.js v14 best practices
- ✅ Zero LSP diagnostics and clean console operation achieved

## Empty Option & Photos to GIF Feature (2025-08-13)
- ✅ Added empty option "─────────────────" in conversion select menu for thread reuse
- ✅ Users can now select empty option to reuse thread without closing and reopening
- ✅ Implemented "Fotos para GIF" function for authorized roles:
  - 953748686884716574 (Booster original)
  - 1385756391284805713 (Additional role 1)
  - 1363537738984591594 (Additional role 2)
- ✅ Modal system for frame duration configuration (1-30 frames per photo)
- ✅ Support for up to 10 images per GIF conversion
- ✅ Multiple image processing with automatic resizing to 720p
- ✅ High-quality GIF generation using FFmpeg with two-pass palette optimization
- ✅ Progress tracking during photo processing and GIF creation
- ✅ Comprehensive error handling for invalid images and processing failures
- ✅ Automatic cleanup of temporary files and frame data
- ✅ Integration with existing conversion statistics system
- ✅ Updated permission system to support multiple authorized roles

## Converter Optimization Feature (2025-08-13)
- ✅ Added automatic optimization prompt when converted files exceed 25MB Discord limit
- ✅ Interactive button system asking user "Sim" (Yes) or "Não" (No) for optimization attempt
- ✅ Secondary attempt with enhanced compression settings for video-to-gif and resize-gif
- ✅ Optimized parameters: lower resolution, reduced FPS, fewer colors, higher compression
- ✅ Video-to-gif optimization: 320px width, 10 FPS, 128 colors, 8s duration, more dithering
- ✅ Resize-gif optimization: minimum 85% compression, 3x lossy value, reduced color palette
- ✅ Comprehensive error handling for both optimization success and failure scenarios
- ✅ Clear user feedback with different messages for first attempt vs optimized version
- ✅ Automatic cleanup of temporary files and conversation data
- ✅ Integration with existing feedback system for optimized conversions

## Discord Components V2 Demo (2025-08-13)
- ✅ Added !embedteste command demonstrating Discord Components V2
- ✅ Full implementation with MessageFlags.IsComponentsV2
- ✅ 4 ActionRow containers with organized button sections
- ✅ Interactive select menu with multi-selection support
- ✅ Comprehensive button handlers for all interactions
- ✅ Detailed responses showing technical implementation
- ✅ Educational content about Components V2 features
- ✅ Code examples and best practices included
- ✅ Proper error handling and user feedback
- ✅ Compatible with discord.js v14

## Banner Converter Zoom Feature (2025-08-13)
- ✅ Added zoom in (🔍+) and zoom out (🔍-) buttons to Discord banner converter
- ✅ Red area dynamically resizes based on zoom level (50% - 300%)
- ✅ Bot sends original image first, outside of embed
- ✅ Embed only updates when buttons are clicked
- ✅ Added zoom percentage indicator in the interface
- ✅ Improved user experience with visual zoom feedback
- ✅ Integrated with main bot system in index.js
- ✅ Interactive crop session uses utils/bannerCrop.js module
- ✅ Proper button handling for banner_crop_ interactions
- ✅ Compatible with existing conversion workflow

# System Architecture

## Core Framework
- **Discord.js Library**: Uses the latest Discord.js v14+ with comprehensive intent and partial configurations for full Discord API access
- **Event-Driven Architecture**: Built around Discord gateway events with support for buttons, modals, select menus, and embeds
- **Modular Component System**: Implements Discord's interaction components (ActionRows, Buttons, Modals, TextInputs, SelectMenus)

## Database Layer
- **PostgreSQL Database**: Uses native `pg` client for direct database operations
- **Connection Management**: Database connection established on startup with error handling
- **Schema Initialization**: Includes database initialization function for table setup

## Media Processing Pipeline
- **Image Processing**: Sharp library for high-performance image manipulation and optimization
- **Video Processing**: FFmpeg integration with static binary for video encoding/decoding operations
- **GIF Optimization**: Gifsicle integration for GIF compression and optimization
- **Canvas Rendering**: HTML5 Canvas API for custom image generation with font support

## Web Services Integration
- **YouTube Integration**: ytdl-core library for YouTube video data extraction and processing
- **HTTP Client**: node-fetch for modern Promise-based HTTP requests
- **Express Server**: Built-in web server for webhook handling or API endpoints

## Task Scheduling
- **Cron Jobs**: node-cron for scheduled background tasks and automated operations
- **Background Processing**: Support for time-based operations and maintenance tasks

## Development Environment
- **Environment Configuration**: dotenv for secure configuration management
- **Font Management**: Custom font registration system for consistent text rendering

# External Dependencies

## Primary Services
- **Discord API**: Core platform integration through Discord.js library
- **PostgreSQL Database**: Primary data persistence layer via connection string
- **YouTube API**: Video content processing through ytdl-core

## Media Processing Tools
- **FFmpeg**: Video/audio processing with static binary distribution
- **Sharp**: High-performance image processing library
- **Gifsicle**: GIF optimization and manipulation tool
- **Canvas**: Server-side image generation and text rendering

## Utility Libraries
- **node-fetch**: Modern HTTP client for API requests
- **node-cron**: Task scheduling and automation
- **express**: Web server framework for HTTP endpoints
- **request**: Legacy HTTP client (consider migration to fetch)

## System Resources
- **Custom Fonts**: Arial Bold font file for consistent text rendering
- **Static Binaries**: FFmpeg binary for cross-platform video processing
- **File System**: Direct file operations for media handling and storage