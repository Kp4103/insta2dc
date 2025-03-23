// Instagram DM to Discord Bot

// Required packages
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const Instagram = require('instagram-private-api');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();
console.log('Environment loaded:', !!process.env.IG_USERNAME);

// Helper function for delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Discord client
const discordClient = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

// Initialize Instagram client
const igClient = new Instagram.IgApiClient();

// Create a global store for processed messages
global.processedMessages = new Set();

// Store for channel mappings
const userChannels = new Map();

// Set the usernames you want to monitor
// Add usernames in lowercase to make comparisons case-insensitive
const targetUsernames = (process.env.TARGET_USERNAMES || '')
  .split(',')
  .map(username => username.trim().toLowerCase())
  .filter(username => username);

console.log(`Configured to monitor DMs from: ${targetUsernames.length > 0 ? targetUsernames.join(', ') : 'all users'}`);

// Instagram login function
async function loginToInstagram() {
  // Debug: Check if environment variables are loaded
  console.log('Instagram username available:', !!process.env.IG_USERNAME);
  console.log('Instagram password available:', !!process.env.IG_PASSWORD);
  
  if (!process.env.IG_USERNAME || !process.env.IG_PASSWORD) {
    throw new Error('Instagram credentials not found in environment variables');
  }
  
  igClient.state.generateDevice(process.env.IG_USERNAME);
  
  try {
    // Log in to Instagram
    await igClient.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
    console.log('Logged into Instagram successfully');
  } catch (error) {
    console.error('Instagram login failed:', error.message);
    throw error;
  }
}

// Get or create a channel for a specific Instagram user
async function getOrCreateUserChannel(username) {
  try {
    // Check if we already have a channel for this user
    if (userChannels.has(username)) {
      return userChannels.get(username);
    }
    
    // Format the channel name by removing invalid characters and replacing spaces with hyphens
    const channelName = `ig-${username.toLowerCase().replace(/[^\w-]/g, '-')}`;
    
    // Get the guild (server) we're working with
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      console.error('DISCORD_GUILD_ID not set in environment variables');
      return null; // Return null instead of default channel
    }
    
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`Could not find guild with ID ${guildId}`);
      return null; // Return null instead of default channel
    }
    
    // Check if the channel already exists
    let channel = guild.channels.cache.find(ch => 
      ch.type === ChannelType.GuildText && ch.name === channelName
    );
    
    // If not, create it
    if (!channel) {
      console.log(`Creating new channel: ${channelName}`);
      
      // Get the category if specified
      let categoryId = process.env.DISCORD_CATEGORY_ID;
      let parent = categoryId ? guild.channels.cache.get(categoryId) : null;
      
      try {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: parent,
          topic: `Instagram DMs from @${username}`,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              // Only allowed users can see these channels
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: guild.members.me.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }
          ]
        });
        
        console.log(`Created channel #${channelName} for Instagram user @${username}`);
      } catch (createError) {
        console.error(`Error creating channel for ${username}:`, createError);
        return null; // Return null if we can't create a channel
      }
    }
    
    // Store the channel for future use
    if (channel) {
      userChannels.set(username, channel);
    }
    
    return channel;
  } catch (error) {
    console.error(`Error in getOrCreateUserChannel for ${username}:`, error);
    return null; // Return null on any error
  }
}

// Set up Discord bot
discordClient.once('ready', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  
  // List all available channels
  console.log('Available Discord channels:');
  discordClient.channels.cache.forEach(channel => {
    if (channel.type === ChannelType.GuildText) {
      console.log(`- ${channel.name}: ${channel.id}`);
    }
  });
});

// Check if a thread should be processed based on usernames
function shouldProcessThread(thread) {
  // If no target usernames are specified, process all threads
  if (targetUsernames.length === 0) {
    return true;
  }
  
  // Check if any user in the thread is in the target list
  if (thread.users && thread.users.length > 0) {
    for (const user of thread.users) {
      const username = user.username.toLowerCase();
      if (targetUsernames.includes(username)) {
        console.log(`Found target user: ${user.username}`);
        return true;
      }
    }
  }
  
  // No matching users found
  return false;
}

// Main function to check and forward DMs
async function checkAndForwardDMs() {
  try {
    console.log('Checking for new Instagram DMs...');
    
    // Get Instagram inbox
    const inbox = await igClient.feed.directInbox().items();
    console.log(`Found ${inbox.length} threads in inbox`);
    
    // Define cutoff times
    const cutoffTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
    const minValidDate = new Date('2010-01-01').getTime(); // Instagram didn't exist before 2010
    const maxValidDate = Date.now() + (24 * 60 * 60 * 1000); // No messages from more than 1 day in the future
    
    // Process messages
    for (const thread of inbox) {
      // Get the username of the first user in the thread
      const username = thread.users[0]?.username || 'unknown_user';
      console.log(`Checking thread with ${username}`);
      
      // Skip threads that don't involve target users
      if (!shouldProcessThread(thread)) {
        console.log(`Skipping thread - not from target user`);
        continue;
      }
      
      try {
        // First, open the thread to trigger content loading in Instagram
        console.log(`Opening thread with ${username} to trigger content loading...`);
        await igClient.feed.directThread({ thread_id: thread.thread_id }).items();
        
        // Wait 5-7 seconds for content to load properly
        const waitTime = 5000 + Math.random() * 2000; // Random time between 5-7 seconds
        console.log(`Waiting ${Math.round(waitTime/1000)} seconds for content to load...`);
        await delay(waitTime);
        
        // Now fetch the messages again after the delay
        const messages = await igClient.feed.directThread({ thread_id: thread.thread_id }).items();
        console.log(`Retrieved ${messages.length} messages from thread after waiting`);
        
        // Sort messages by timestamp (oldest first)
        const sortedMessages = [...messages].sort((a, b) => {
          // Convert timestamps to numbers for comparison
          const timestampA = typeof a.timestamp === 'string' ? Number(a.timestamp) : a.timestamp;
          const timestampB = typeof b.timestamp === 'string' ? Number(b.timestamp) : b.timestamp;
          
          // Sort ascending (oldest first)
          return timestampA - timestampB;
        });
        
        // Get or create the channel for this user
        const userChannel = await getOrCreateUserChannel(username);
        
        if (!userChannel) {
          console.error(`Could not get or create channel for ${username}, skipping thread`);
          continue;
        }
        
        // Process messages
        for (const message of sortedMessages) {
          // Skip if we've processed this message before
          if (global.processedMessages.has(message.item_id)) {
            continue;
          }
          
          // Check if message was sent by the bot's user or received from someone else
          const isSentByUser = message.is_sent_by_viewer === true;
          
          // Choose different colors for sent vs received messages
          const messageColor = isSentByUser ? '#2196F3' : '#E1306C'; // Blue for sent, Pink for received
          
          // Create embed with the appropriate color
          const embed = new EmbedBuilder()
            .setColor(messageColor)
            .setFooter({ text: isSentByUser ? 'Sent via Instagram DM' : 'Received via Instagram DM' });
          
          // Set content based on message type
          if (message.item_type === 'placeholder') {
            console.log('Processing placeholder message, trying to extract text content...');
            
            // Debug: Log the full placeholder structure
            console.log('Placeholder structure:', JSON.stringify(message, null, 2));
            
            // For vanishing mode messages, we can identify them by the placeholder content
            let isVanishingMode = false;
            let placeholderTitle = '';
            let placeholderMessage = '';
            
            if (message.placeholder) {
              placeholderTitle = message.placeholder.title || '';
              placeholderMessage = message.placeholder.message || '';
              
              // Check if this is a vanishing mode message
              if (message.is_disappearing === true || 
                (placeholderTitle === "Use Latest App" && 
                 placeholderMessage.includes("Use the latest version of the Instagram app"))) {
                isVanishingMode = true;
              }
            }
            
            const direction = isSentByUser ? 'You sent to' : 'From';
            
            if (isVanishingMode) {
              // This is a vanishing mode message that Instagram won't show through the API
              embed.setTitle(`${direction} ${username}: Vanishing Mode Message`);
              let description = "This message was sent in vanishing mode. ";
              description += "Instagram doesn't allow third-party apps to see the content of vanishing messages.";
              
              embed.setDescription(description);
            } else {
              // Regular placeholder
              embed.setTitle(`${direction} ${username}: Placeholder Message`);
              let description = "This message is still loading in Instagram. ";
              description += "It may contain media or other content that will appear soon.";
              
              embed.setDescription(description);
            }
          }
          else if (message.item_type === 'text') {
            const direction = isSentByUser ? 'You to' : 'From';
            embed.setTitle(`${direction} ${username}`);
            embed.setDescription(message.text || '(No text)');
          } 
          else if (message.item_type === 'media_share') {
            // Handle shared posts
            console.log('Message contains shared media post');
            
            let mediaTitle = 'Shared Post';
            let mediaLink = '';
            let thumbnailUrl = '';
            
            if (message.media_share) {
              // Extract post code for link
              if (message.media_share.code) {
                mediaLink = `https://www.instagram.com/p/${message.media_share.code}/`;
              }
              
              // Try to get post caption
              let postCaption = '';
              if (message.media_share.caption && message.media_share.caption.text) {
                postCaption = `\n\n*"${message.media_share.caption.text.substring(0, 100)}${message.media_share.caption.text.length > 100 ? '...' : ''}"*`;
              }
              
              // Extract thumbnail URL
              if (message.media_share.image_versions2 && 
                  message.media_share.image_versions2.candidates && 
                  message.media_share.image_versions2.candidates.length > 0) {
                thumbnailUrl = message.media_share.image_versions2.candidates[0].url;
              }
              
              // Get post owner username if available
              let postOwner = '';
              if (message.media_share.user && message.media_share.user.username) {
                postOwner = message.media_share.user.username;
                mediaTitle = `Post from @${postOwner}`;
              }
            }
            
            const direction = isSentByUser ? 'You shared with' : 'Shared by';
            embed.setTitle(`${direction} ${username}: ${mediaTitle}`);
            
            // Add description with caption and link
            let description = message.text || '(No message)';
            if (mediaLink) {
              description += `\n\n[View on Instagram](${mediaLink})`;
            }
            
            embed.setDescription(description);
            
            // Add thumbnail if available
            if (thumbnailUrl) {
              embed.setImage(thumbnailUrl);
            }
          }
          else if (message.item_type === 'clip') {
            console.log('Found a clip message');
            
            // Initialize variables
            let mediaLink = '';
            let thumbnailUrl = '';
            let reelCaption = '';
            let reelOwner = 'Instagram User';
            
            try {
              // Extract the code from the nested structure
              if (message.clip && message.clip.clip) {
                const clipData = message.clip.clip;
                
                // Get reel code
                if (clipData.code) {
                  mediaLink = `https://www.instagram.com/reel/${clipData.code}/`;
                  console.log(`Found reel code: ${clipData.code}`);
                }
                
                // Get reel caption
                if (clipData.caption && clipData.caption.text) {
                  reelCaption = clipData.caption.text;
                }
                
                // Get reel owner username
                if (clipData.user && clipData.user.username) {
                  reelOwner = clipData.user.username;
                }
                
                // Get thumbnail from image_versions2
                if (clipData.image_versions2 && 
                    clipData.image_versions2.candidates && 
                    clipData.image_versions2.candidates.length > 0) {
                  thumbnailUrl = clipData.image_versions2.candidates[0].url;
                }
              } 
              // Try alternative paths if the primary path doesn't exist
              else if (message.clip && message.clip.code) {
                mediaLink = `https://www.instagram.com/reel/${message.clip.code}/`;
              }
              else if (message.media_id) {
                mediaLink = `https://www.instagram.com/reel/${message.media_id}/`;
              }
              else {
                // If all else fails, look for any property that might contain the code
                console.log('Could not find direct code path, searching for alternative properties');
                const clipId = message.id || message.clip_id || 
                  (message.item_id ? message.item_id.split('_')[0] : '');
                
                if (clipId) {
                  mediaLink = `https://www.instagram.com/reel/${clipId}/`;
                }
              }

              // Set title with owner info
              const direction = isSentByUser ? 'You shared with' : 'Shared by';
              embed.setTitle(`${direction} ${username}: Instagram Reel from @${reelOwner}`);
              
              // Add message text, caption, and link to description
              let description = message.text || '(No message)';
              
              // Add reel caption if available and different from the message
              if (reelCaption && reelCaption !== message.text) {
                description += `\n\n*"${reelCaption.substring(0, 100)}${reelCaption.length > 100 ? '...' : ''}"*`;
              }
              
              // Add link to description
              if (mediaLink) {
                description += `\n\n[Watch on Instagram](${mediaLink})`;
              } else {
                description += "\n\n(Could not extract Instagram link)";
              }
              
              embed.setDescription(description);
              
              // Add thumbnail if available
              if (thumbnailUrl) {
                embed.setImage(thumbnailUrl);
              }
            } catch (error) {
              console.error('Error processing clip:', error);
              const direction = isSentByUser ? 'You shared with' : 'Shared by';
              embed.setTitle(`${direction} ${username}: Instagram Reel`);
              embed.setDescription('Error processing Instagram reel');
            }
          }
          else if (message.item_type === 'media') {
            // Standard media like photos or videos
            console.log('Message contains media (photo/video)');
            
            let mediaTitle = 'Photo/Video';
            let mediaLink = '';
            let thumbnailUrl = '';
            
            // Try to extract media information
            if (message.visual_media && message.visual_media.media) {
              const mediaData = message.visual_media.media;
              
              // Get media ID for link
              if (mediaData.code) {
                mediaLink = `https://www.instagram.com/p/${mediaData.code}/`;
              } else if (mediaData.id) {
                const mediaId = mediaData.id;
                mediaLink = `https://www.instagram.com/p/${mediaId}/`;
              }
              
              // Extract image URL
              if (mediaData.image_versions2 && 
                  mediaData.image_versions2.candidates && 
                  mediaData.image_versions2.candidates.length > 0) {
                thumbnailUrl = mediaData.image_versions2.candidates[0].url;
              }
            } else if (message.item_id) {
              const mediaId = message.item_id.split('_')[0];
              mediaLink = `Media content (ID: ${mediaId})`;
            }
            
            const direction = isSentByUser ? 'You sent to' : 'From';
            embed.setTitle(`${direction} ${username}: ${mediaTitle}`);
            
            // Add description with caption and link
            let description = message.text || '(No caption)';
            if (mediaLink) {
              description += `\n\n[View on Instagram](${mediaLink})`;
            }
            
            embed.setDescription(description);
            
            // Add image if available
            if (thumbnailUrl) {
              embed.setImage(thumbnailUrl);
            }
          }
          else if (message.story_share) {
            // Handle shared stories
            const mediaTitle = 'Instagram Story';
            let description = message.text || '';
            let thumbnailUrl = '';
            
            if (message.story_share.media) {
              const storyData = message.story_share.media;
              
              // Get story owner username
              let storyOwner = 'Instagram User';
              if (storyData.user && storyData.user.username) {
                storyOwner = storyData.user.username;
              }
              
              // Extract story link
              const storyLink = `https://www.instagram.com/stories/${storyOwner}/`;
              
              // Updated description with username and links
              description += `\n\nShared a story from @${storyOwner}\n[View Profile](https://www.instagram.com/${storyOwner}/) | [View Stories](${storyLink})`;
              
              // Extract thumbnail URL
              if (storyData.image_versions2 && 
                  storyData.image_versions2.candidates && 
                  storyData.image_versions2.candidates.length > 0) {
                thumbnailUrl = storyData.image_versions2.candidates[0].url;
              }
              
              const direction = isSentByUser ? 'You shared with' : 'Shared by';
              embed.setTitle(`${direction} ${username}: ${mediaTitle} from @${storyOwner}`);
            } else {
              const direction = isSentByUser ? 'You shared with' : 'Shared by';
              embed.setTitle(`${direction} ${username}: ${mediaTitle}`);
            }
            
            embed.setDescription(description);
            
            // Add image if available
            if (thumbnailUrl) {
              embed.setImage(thumbnailUrl);
            }
          }
          else if (message.item_type === 'like' || message.item_type === 'action_log') {
            // Handle like or action messages
            const direction = isSentByUser ? 'You' : username;
            embed.setTitle(`${direction} sent an activity: ${message.item_type}`);
            embed.setDescription(`Activity type: ${message.item_type}`);
          } 
          else {
            // Handle other message types
            const direction = isSentByUser ? 'You to' : 'From';
            embed.setTitle(`${direction} ${username}`);
            embed.setDescription(`Message type: ${message.item_type}`);
          }
          
          // New timestamp handling approach
          try {
            // Get raw timestamp value
            let rawTimestamp = message.timestamp;
            
            // First, try to handle it as a standard Unix timestamp (milliseconds since epoch)
            // Instagram typically sends timestamps this way
            if (rawTimestamp && (typeof rawTimestamp === 'number' || !isNaN(Number(rawTimestamp)))) {
              // Convert to number if it's a string
              const timestamp = typeof rawTimestamp === 'string' ? Number(rawTimestamp) : rawTimestamp;
              
              // Check if it's a reasonable timestamp (between 2010 and 2030)
              // Most Instagram timestamps should be in this range
              const date = new Date(timestamp);
              const year = date.getFullYear();
              
              if (!isNaN(date.getTime()) && year >= 2010 && year <= 2030) {
                // This appears to be a valid timestamp
                const formattedTime = date.toLocaleString();
                
                // Add a field for the timestamp
                embed.addFields({ 
                  name: isSentByUser ? '📤 Sent at' : '📥 Received at', 
                  value: formattedTime,
                  inline: true
                });
              } else {
                // If the date is invalid or outside reasonable range, try another approach
                // Sometimes Instagram sends timestamps in microseconds instead of milliseconds
                const microsecDate = new Date(timestamp / 1000);
                const microYear = microsecDate.getFullYear();
                
                if (!isNaN(microsecDate.getTime()) && microYear >= 2010 && microYear <= 2030) {
                  const formattedMicroTime = microsecDate.toLocaleString();
                  
                  embed.addFields({ 
                    name: isSentByUser ? '📤 Sent at' : '📥 Received at', 
                    value: formattedMicroTime,
                    inline: true
                  });
                } else {
                  // If all timestamp conversions fail, use a generic message
                  embed.addFields({ 
                    name: 'Timestamp',
                    value: 'Unable to determine exact time',
                    inline: true
                  });
                }
              }
            } else {
              // If timestamp is missing or not a number
              embed.addFields({ 
                name: 'Timestamp',
                value: 'No timestamp available',
                inline: true
              });
            }
          } catch (timeError) {
            console.log(`Error processing timestamp: ${timeError.message}`);
            embed.addFields({ 
              name: 'Timestamp',
              value: 'Error processing timestamp',
              inline: true
            });
          }
          
          // Check if message is recent enough to forward
          // Use the message timestamp if valid, or current time as fallback
          let messageTime;
          try {
            messageTime = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
          } catch (e) {
            messageTime = Date.now();
          }
          
          if (messageTime > cutoffTime) {
            try {
              // Send to the specific user's Discord channel
              await userChannel.send({ embeds: [embed] });
              console.log(`Message sent to Discord channel #${userChannel.name} (type: ${message.item_type})`);
              
              // Add to processed set
              global.processedMessages.add(message.item_id);
              
              // Keep the set from growing too large
              if (global.processedMessages.size > 1000) {
                const toRemove = Array.from(global.processedMessages).slice(0, 500);
                toRemove.forEach(id => global.processedMessages.delete(id));
              }
            } catch (sendError) {
              console.error(`Error sending message to Discord:`, sendError);
            }
          }
        }
      } catch (threadError) {
        console.error(`Error processing thread ${thread.thread_id}:`, threadError);
        // Continue with next thread
        continue;
      }
      
      // Add a delay between checking threads to avoid rate limiting
      await delay(2000);
    }
  } catch (error) {
    console.error('Error checking DMs:', error);
  }
}

// Check pending messages
async function checkPendingMessages() {
  try {
    console.log('Checking pending Instagram DMs...');
    
    // Define valid date range
    const minValidDate = new Date('2010-01-01').getTime();
    const maxValidDate = Date.now() + (24 * 60 * 60 * 1000);
    
    // Get pending inbox (message requests)
    const pendingInbox = await igClient.feed.directPending().items();
    console.log(`Found ${pendingInbox.length} pending threads`);
    
    for (const thread of pendingInbox) {
      // Get the username of the first user in the thread
      const username = thread.users[0]?.username || 'unknown_user';
      console.log(`Processing pending thread from ${username}`);
      
      // Skip threads that don't involve target users
      if (!shouldProcessThread(thread)) {
        console.log(`Skipping pending thread - not from target user`);
        continue;
      }
      
      try {
        // First, open the thread to trigger content loading in Instagram
        console.log(`Opening pending thread with ${username} to trigger content loading...`);
        await igClient.feed.directThread({ thread_id: thread.thread_id }).items();
        
        // Wait 5-7 seconds for content to load properly
        const waitTime = 5000 + Math.random() * 2000; // Random time between 5-7 seconds
        console.log(`Waiting ${Math.round(waitTime/1000)} seconds for content to load...`);
        await delay(waitTime);
        
        // Now fetch the messages again after the delay
        const messages = await igClient.feed.directThread({ thread_id: thread.thread_id }).items();
        console.log(`Retrieved ${messages.length} messages from pending thread after waiting`);
        
        // Sort messages by timestamp (oldest first)
        const sortedMessages = [...messages].sort((a, b) => {
          // Convert timestamps to numbers for comparison
          const timestampA = typeof a.timestamp === 'string' ? Number(a.timestamp) : a.timestamp;
          const timestampB = typeof b.timestamp === 'string' ? Number(b.timestamp) : b.timestamp;
          
          // Sort ascending (oldest first)
          return timestampA - timestampB;
        });
        
        // Get or create the channel for this user
        const userChannel = await getOrCreateUserChannel(username);
        
        if (!userChannel) {
          console.error(`Could not get or create channel for ${username}, skipping thread`);
          continue;
        }
        
        for (const message of sortedMessages) {
          // Skip if we've processed this message before
          if (global.processedMessages.has(message.item_id)) {
            continue;
          }
          
          // Check if message was sent by the bot's user or received from someone else
          const isSentByUser = message.is_sent_by_viewer === true;
          
          // Choose different colors for sent vs received messages
          const messageColor = isSentByUser ? '#2196F3' : '#E1306C'; // Blue for sent, Pink for received
          
          // Initialize embed
          const embed = new EmbedBuilder()
            .setColor(messageColor)
            .setFooter({ text: isSentByUser ? 'Sent via Instagram DM (Pending)' : 'Received via Instagram DM (Pending)' });
          
          // Handle different message types (similar to regular messages but with pending indicators)
          if (message.item_type === 'placeholder') {
            console.log('Processing pending placeholder message, trying to extract text content...');
            
            // Debug: Log the full placeholder structure
            console.log('Placeholder structure:', JSON.stringify(message, null, 2));
            
            // For vanishing mode messages, we can identify them by the placeholder content
            let isVanishingMode = false;
            let placeholderTitle = '';
            let placeholderMessage = '';
            
            if (message.placeholder) {
              placeholderTitle = message.placeholder.title || '';
              placeholderMessage = message.placeholder.message || '';
              
              // Check if this is a vanishing mode message
              if (message.is_disappearing === true || 
                 (placeholderTitle === "Use Latest App" && 
                  placeholderMessage.includes("Use the latest version of the Instagram app"))) {
                isVanishingMode = true;
              }
            }
            
            const direction = isSentByUser ? 'You sent to' : 'From';
            
            if (isVanishingMode) {
              // This is a vanishing mode message that Instagram won't show through the API
              embed.setTitle(`${direction} ${username}: Vanishing Mode Message (Pending)`);
              let description = "This message was sent in vanishing mode. ";
              description += "Instagram doesn't allow third-party apps to see the content of vanishing messages.";
              
              embed.setDescription(description);
            } else {
              // Regular placeholder
              embed.setTitle(`${direction} ${username}: Placeholder Message (Pending)`);
              let description = "This message is still loading in Instagram. ";
              description += "It may contain media or other content that will appear soon.";
              
              embed.setDescription(description);
            }
          }
          else if (message.item_type === 'text') {
            const direction = isSentByUser ? 'You to' : 'From';
            embed.setTitle(`${direction} ${username} (Pending)`);
            embed.setDescription(message.text || '(No text)');
          } 
          else if (message.item_type === 'clip') {
            console.log('Found a pending clip message');
            
            // Initialize variables
            let mediaLink = '';
            let thumbnailUrl = '';
            let reelCaption = '';
            let reelOwner = 'Instagram User';
            
            try {
              // Extract the code from the nested structure
              if (message.clip && message.clip.clip) {
                const clipData = message.clip.clip;
                
                // Get reel code
                if (clipData.code) {
                  mediaLink = `https://www.instagram.com/reel/${clipData.code}/`;
                  console.log(`Found pending reel code: ${clipData.code}`);
                }
                
                // Get reel caption
                if (clipData.caption && clipData.caption.text) {
                  reelCaption = clipData.caption.text;
                }
                
                // Get reel owner username
                if (clipData.user && clipData.user.username) {
                  reelOwner = clipData.user.username;
                }
                
                // Get thumbnail from image_versions2
                if (clipData.image_versions2 && 
                    clipData.image_versions2.candidates && 
                    clipData.image_versions2.candidates.length > 0) {
                  thumbnailUrl = clipData.image_versions2.candidates[0].url;
                }
              } 
              // Try alternative paths if the primary path doesn't exist
              else if (message.clip && message.clip.code) {
                mediaLink = `https://www.instagram.com/reel/${message.clip.code}/`;
              }
              else if (message.media_id) {
                mediaLink = `https://www.instagram.com/reel/${message.media_id}/`;
              }
              else {
                // If all else fails, look for any property that might contain the code
                console.log('Could not find direct code path, searching for alternative properties');
                const clipId = message.id || message.clip_id || 
                  (message.item_id ? message.item_id.split('_')[0] : '');
                
                if (clipId) {
                  mediaLink = `https://www.instagram.com/reel/${clipId}/`;
                }
              }

              // Set title with owner info
              const direction = isSentByUser ? 'You shared with' : 'Shared by';
              embed.setTitle(`${direction} ${username}: Instagram Reel from @${reelOwner} (Pending)`);
              
              // Add message text, caption, and link to description
              let description = message.text || '(No message)';
              
              // Add reel caption if available and different from the message
              if (reelCaption && reelCaption !== message.text) {
                description += `\n\n*"${reelCaption.substring(0, 100)}${reelCaption.length > 100 ? '...' : ''}"*`;
              }
              
              // Add link to description
              if (mediaLink) {
                description += `\n\n[Watch on Instagram](${mediaLink})`;
              } else {
                description += "\n\n(Could not extract Instagram link)";
              }
              
              embed.setDescription(description);
              
              // Add thumbnail if available
              if (thumbnailUrl) {
                embed.setImage(thumbnailUrl);
              }
            } catch (error) {
              console.error('Error processing pending clip:', error);
              const direction = isSentByUser ? 'You shared with' : 'Shared by';
              embed.setTitle(`${direction} ${username}: Instagram Reel (Pending)`);
              embed.setDescription('Error processing Instagram reel');
            }
          }
          else if (message.item_type === 'media_share') {
            // Handle shared posts in pending
            let mediaTitle = 'Shared Post';
            let mediaLink = '';
            let thumbnailUrl = '';
            
            if (message.media_share) {
              // Extract post code for link
              if (message.media_share.code) {
                mediaLink = `https://www.instagram.com/p/${message.media_share.code}/`;
              }
              
              // Try to get post caption
              let postCaption = '';
              if (message.media_share.caption && message.media_share.caption.text) {
                postCaption = `\n\n*"${message.media_share.caption.text.substring(0, 100)}${message.media_share.caption.text.length > 100 ? '...' : ''}"*`;
              }
              
              // Extract thumbnail URL
              if (message.media_share.image_versions2 && 
                  message.media_share.image_versions2.candidates && 
                  message.media_share.image_versions2.candidates.length > 0) {
                thumbnailUrl = message.media_share.image_versions2.candidates[0].url;
              }
              
              // Get post owner username if available
              let postOwner = '';
              if (message.media_share.user && message.media_share.user.username) {
                postOwner = message.media_share.user.username;
                mediaTitle = `Post from @${postOwner}`;
              }
            }
            
            const direction = isSentByUser ? 'You shared with' : 'Shared by';
            embed.setTitle(`${direction} ${username}: ${mediaTitle} (Pending)`);
            
            // Add description with caption and link
            let description = message.text || '(No message)';
            if (mediaLink) {
              description += `\n\n[View on Instagram](${mediaLink})`;
            }
            
            embed.setDescription(description);
            
            // Add thumbnail if available
            if (thumbnailUrl) {
              embed.setImage(thumbnailUrl);
            }
          } 
          else {
            // Handle other message types
            const direction = isSentByUser ? 'You to' : 'From';
            embed.setTitle(`${direction} ${username} (Pending)`);
            embed.setDescription(`Message type: ${message.item_type}`);
          }
            
          // Format timestamp for display
          try {
            const timestamp = typeof message.timestamp === 'string' ? 
              Number(message.timestamp) : message.timestamp;
            
            if (typeof timestamp === 'number' && !isNaN(timestamp)) {
              const date = new Date(timestamp);
              if (!isNaN(date.getTime())) {
                const formattedTime = date.toLocaleString();
                
                // Add a field for the timestamp
                embed.addFields({ 
                  name: isSentByUser ? '📤 Sent at' : '📥 Received at', 
                  value: formattedTime,
                  inline: true
                });
                
                // Still use the timestamp for sorting in Discord
                embed.setTimestamp(date);
              }
            }
          } catch (timeError) {
            console.log(`Error formatting timestamp: ${timeError.message}`);
          }
          
          try {
            // Send to the specific user's Discord channel
            await userChannel.send({ embeds: [embed] });
            console.log(`Pending message sent to Discord channel #${userChannel.name}`);
            
            // Approve the message if it's from a pending request
            if (message.item_type !== 'placeholder') { // Don't approve threads with placeholder messages
              try {
                await igClient.directThread.approve(thread.thread_id);
                console.log('Thread approved');
              } catch (approveError) {
                console.error('Error approving thread:', approveError);
              }
            }
            
            // Add to processed set
            global.processedMessages.add(message.item_id);
            
            // Keep the set from growing too large
            if (global.processedMessages.size > 1000) {
              const toRemove = Array.from(global.processedMessages).slice(0, 500);
              toRemove.forEach(id => global.processedMessages.delete(id));
            }
          } catch (sendError) {
            console.error(`Error sending pending message to Discord:`, sendError);
          }
        }
      } catch (threadError) {
        console.error(`Error processing pending thread ${thread.thread_id}:`, threadError);
        continue;
      }
      
      await delay(2000);
    }
  } catch (error) {
    console.error('Error checking pending DMs:', error);
  }
}

// Function to keep Instagram session alive
async function keepInstagramSessionAlive() {
  try {
    console.log('Refreshing Instagram session...');
    
    // Perform a simple action to keep the session alive
    await igClient.feed.timeline().items();
    
    console.log('Instagram session refreshed');
  } catch (error) {
    console.error('Failed to refresh Instagram session:', error);
    
    // Try to log in again if session expired
    try {
      await loginToInstagram();
      console.log('Re-logged into Instagram');
    } catch (loginError) {
      console.error('Failed to re-login to Instagram:', loginError);
    }
  }
}

// Start the application
async function start() {
  try {
    // Login to both platforms
    await loginToInstagram();
    await discordClient.login(process.env.DISCORD_TOKEN);
    
    console.log('Both platforms logged in successfully. Starting message forwarding...');
    
    // Initial check right away
    setTimeout(async () => {
      await checkAndForwardDMs();
      await checkPendingMessages();
    }, 5000); // Wait 5 seconds after login before first check
    
    // Check DMs periodically
    setInterval(checkAndForwardDMs, 30000); // Check every 30 seconds
    setInterval(checkPendingMessages, 45000); // Check pending inbox every 45 seconds
    setInterval(keepInstagramSessionAlive, 30 * 60 * 1000); // Keep session alive every 30 minutes
  } catch (error) {
    console.error('Error starting application:', error);
  }
}

// Handle process errors and shutdown
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  process.exit(0);
});

// Start the bot
start();