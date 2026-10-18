/*
 * Buffer for chatMessages for the server
 * it just buffers the most recent 200 messages for each channel
 *
 */
import {
  storeMessage,
  getMessagesForChannel,
  deletePublicUserMessages,
} from '../data/sql/Message.js';

const MAX_BUFFER_TIME = 600000;

class ChatMessageBuffer {
  constructor(socketEvents) {
    this.buffer = new Map();
    this.timestamps = new Map();

    this.cleanBuffer = this.cleanBuffer.bind(this);
    this.cleanLoop = setInterval(this.cleanBuffer, 3 * 60 * 1000);
    this.addMessage = this.addMessage.bind(this);
    this.resetBuffers = this.resetBuffers.bind(this);
    this.socketEvents = socketEvents;
    socketEvents.on('chatMessage', this.addMessage);
    /*
     * reset buffers when public messages got deleted, since we do not know
     * which channels exactly got affected
     */
    socketEvents.on('deletePublicUserMessages', this.resetBuffers);
    /*
     * if messages from a channel got deleted, just reset this channel
     */
    socketEvents.on('deleteMessages', (cid) => this.buffer.delete(cid));
    socketEvents.on(
      'deleteUserChannelMessages', (uid, cid) => this.buffer.delete(cid),
    );
  }

  async getMessages(cid, limit = 30) {
    if (limit > 200) {
      return getMessagesForChannel(cid, limit);
    }

    let messages = this.buffer.get(cid);
    if (!messages) {
      messages = await getMessagesForChannel(cid, limit);
      this.buffer.set(cid, messages);
    }
    this.timestamps.set(cid, Date.now());
    return messages.slice(-limit);
  }

  cleanBuffer() {
    const curTime = Date.now();
    const toDelete = [];
    this.timestamps.forEach((timestamp, cid) => {
      if (curTime > timestamp + MAX_BUFFER_TIME) {
        toDelete.push(cid);
      }
    });
    toDelete.forEach((cid) => {
      this.timestamps.delete(cid);
      this.buffer.delete(cid);
    });
  }

  resetBuffers() {
    this.buffer.clear();
    this.timestamps.clear();
  }

  async broadcastChatMessage(
    name,
    message,
    cid,
    uid,
    flag = 'xx',
    flagLegit = false,
    avatarId = null,
    nameStyleOrSendapi = true,
    sendapi = true,
  ) {
    let nameStyle = 'none';
    if (typeof nameStyleOrSendapi === 'string') nameStyle = nameStyleOrSendapi;
    else sendapi = nameStyleOrSendapi;
    const ts = Math.floor(Date.now() / 1000);
    // this may throw!
    const [msgId, attachments] = await storeMessage(message, cid, uid);

    /*
     * goes through socket events and then comes
     * back at addMessage
     */
    this.socketEvents.broadcastChatMessage(
      name,
      message,
      cid,
      uid,
      flag,
      ts,
      msgId,
      flagLegit,
      avatarId,
      attachments,
      sendapi,
      nameStyle,
    );
    return [ts, msgId, attachments];
  }

  async addMessage(
    name,
    message,
    cid,
    uid,
    flag,
    ts,
    msgId,
    flagLegit,
    avatarId,
    attachments,
    sendapi,
    nameStyle = 'none',
  ) {
    const messages = this.buffer.get(cid);
    if (messages) {
      messages.push([
        name,
        message,
        flag,
        uid,
        ts,
        msgId,
        flagLegit,
        avatarId,
        attachments,
        (typeof sendapi === 'string' ? sendapi : nameStyle),
      ]);
    }
  }

  /*
   * delete all messages of a user from public channels
   */
  async broadcastUserPublicChatMessageDeletion(uid, sendapi = true) {
    deletePublicUserMessages(uid);
    /*
     * goes through socket events and then comes
     * back to resetBuffers
     */
    this.socketEvents.broadcastUserPublicChatMessageDeletion(uid, sendapi);
  }
}

export default ChatMessageBuffer;
