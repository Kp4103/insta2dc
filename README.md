# Instagram DM to Discord Bot

A Node.js bot that forwards Instagram Direct Messages to Discord channels, preserving media, links, and formatting.

## Features

- Forward Instagram DMs to Discord in real-time
- Creates individual Discord channels for each conversation
- Supports various message types (text, photos, videos, shared posts, stories, reels)
- Handles vanishing mode messages
- Processes pending message requests
- Color-coded messages (blue for sent, pink for received)
- Keeps Instagram session alive automatically

## Requirements

- Node.js (v16 or higher)
- Instagram account credentials
- Discord bot token and server (guild)

## Installation

1. Clone this repository
   ```
   git clone https://github.com/yourusername/instagram-dm-discord-bot.git
   cd instagram-dm-discord-bot
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Create a `.env` file with your credentials (see `.env.example`)

4. Start the bot
   ```
   node bot.js
   ```

## Environment Variables

Create a `.env` file with the following variables:

```
IG_USERNAME=your_instagram_username
IG_PASSWORD=your_instagram_password
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_discord_server_id
DISCORD_CATEGORY_ID=optional_category_id_for_channels
TARGET_USERNAMES=optional_comma_separated_usernames_to_monitor
```

## Discord Bot Setup

1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot for your application
3. Enable Message Content Intent in the Bot settings
4. Generate a bot token and add it to your .env file
5. Invite the bot to your server with the proper permissions
   - Required permissions: Manage Channels, View Channels, Send Messages, Embed Links

## Notes

- This bot uses the unofficial Instagram Private API. Use at your own risk as it may violate Instagram's Terms of Service.
- For privacy and security, never share your .env file or credentials.
- The bot creates a separate channel for each Instagram conversation to maintain organization.

## Troubleshooting

If you encounter issues:

1. Check the console logs for error messages
2. Ensure your Instagram credentials are correct
3. Verify the Discord bot has proper permissions
4. If Instagram login fails, try logging in manually to confirm your account is not locked or requiring verification

## License

MIT