import OpenAI from 'openai'
import {
  getUser,
  getInvitationRecordByCode,
  newUserFromInvitation,
  createInvitation,
  setCredits,
  getCredits,
  connect
} from './db.mjs'
import tiktoken from 'tiktoken'
import 'dotenv/config'

const MAX_INVITATION_CODE_ATTEMPTS = 10

const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY, // defaults to process.env["OPENAI_API_KEY"]
});

async function askGPT(message, messages) {
  messages.push({
    role: 'user',
    content: message
  })
  const encoding = tiktoken.encoding_for_model('gpt-3.5-turbo')
  do {
    const text = messages.map(m => m.content).join('/n')
    // Tokenize the conversation
    const tokenCount = encoding.encode(text).length;
    if (tokenCount >= 4096) {
      messages.shift()
    } else {
      break;
    }
  } while (true)

  const chatCompletion = await openai.chat.completions.create({
    messages: messages,
    model: 'gpt-3.5-turbo',
  });
  messages.push(chatCompletion.choices[0].message)
  return chatCompletion.choices[0];
}

import TelegramBot from 'node-telegram-bot-api';

// replace the value below with the Telegram token you receive from @BotFather
const token = process.env.BOT_TOKEN;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, {
  polling: true
});

async function main() {
  const db = await connect();
  await initBot(db)
}

main()


async function initBot(db) {
  bot.on('message', async (msg) => {
    try {
      // Ignore non text messages:
      if (!msg.text) {
        return
      }
      const chatId = msg.chat.id;
      const userIdStr = String(msg.from.id)
      // security
      const currentChat = getChat(msg.from.id)
      const user = await getUser(db, userIdStr)

      if (!user && currentChat.status == 'init') {
        handleNewUser(bot, chatId, currentChat)
        return
      }

      if (currentChat.status == 'invitation_code') {
        await expectInvitationCode({bot, chatId, text: msg.text, userId: userIdStr, db, cachedChat: currentChat})
        return
      }

      let messages = getChatHistory(userIdStr)
      
      if (msg.text.startsWith('/invite')) {
        const name = text.substring(8)
        await handleInvite({db, name, chatId, user})
        return
      }

      if (msg.text === '/start') {
        await bot.sendMessage(chatId, "Hello! =) Send a message to talk with ChatGPT.")
        return
      }
      let credits = await getCredits(db, userIdStr)
      if (credits >= 3) {
      } else {
        await bot.sendMessage(chatId, "Not enough credits.");
        return
      }
      if (msg.text.startsWith('/image')) {
        const prompt = msg.text.substring(7)
        await handleGenerateImage({bot, user, chatId, prompt})
        return
      }
      const update = await bot.sendMessage(chatId, "Generating response...")
      let response = await askGPT(msg.text, messages)
      // send a message to the chat acknowledging receipt of their message
      await bot.deleteMessage(chatId, update.message_id);
      await bot.sendMessage(chatId, response.message.content);
      await db.transaction(async db => {
        const c = await getCredits(db, userIdStr)
        await setCredits(db, userIdStr, c - 3)
      })
      
    } catch (err) {
      console.log(err)
    }
  });

}
const chats = {}

async function processInvitationCode(db, code, userId) {
  try {
    const invitation = await getInvitationRecordByCode(db, code)
    console.log("Invitation + " + invitation)
    if (invitation) {

      await newUserFromInvitation(db, invitation, userId)
    }
    return invitation
  } catch (err) {
    console.log(err)
    return null
  }
}

function getChat(userId) {
  if (!chats[userId]) {
    chats[userId] = {
      messages: [],
      invitationCodeAttempts: 0,
      status: 'init'
    }
  }
  return chats[userId]
}

async function handleInvite({bot, name, user, chatId}) {
  if (user && user.role == 'admin') {
    const code = await createInvitation(db, name)
    await bot.sendMessage(chatId, "Invitation created. Code:")
    await bot.sendMessage(chatId, code)
  } else {
    console.log(user)
    console.log('access denied')
  }
}

async function handleGenerateImage({bot, user, prompt, chatId}) {
  if (user) {
    const response = await openai.images.generate({
      prompt,
      n: 1,
      size: "1024x1024",
    });
    const url = response.data[0].url;
    await bot.sendPhoto(chatId, url)
  }
}

async function handleNewUser(bot, chatId, cachedChat) {
    cachedChat.status = 'invitation_code'
    await bot.sendMessage(chatId, "Enter the invitation code:")
}

function getChatHistory(userId) {
  const chat = getChat(userId)
  return chat.messages
}

async function expectInvitationCode({db, bot, text, userId, cachedChat, chatId}) {
  if (cachedChat.invitationCodeAttempts > MAX_INVITATION_CODE_ATTEMPTS) {
    return 'stop'
  }
  const code = text
  const result = await processInvitationCode(db, code, userId)
  if (result) {
    await bot.sendMessage(chatId, `Welcome, ${result.name}!`)
    cachedChat.status = 'idle'
  } else {
    cachedChat.invitationCodeAttempts += 1
    await bot.sendMessage(chatId, "The code is incorrect.")
  }
  return 'stop'
}