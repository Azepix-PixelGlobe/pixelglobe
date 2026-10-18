import SocketEvents from './SockEvents.js';
import MessageBroker from './MessageBroker.js';
import { IS_CLUSTER } from '../core/config.js';

/*
 * if we are a shard in a cluster, do messaging to others via redis
 */
const socketEvents = (IS_CLUSTER) ? new MessageBroker() : new SocketEvents();

export default socketEvents;
