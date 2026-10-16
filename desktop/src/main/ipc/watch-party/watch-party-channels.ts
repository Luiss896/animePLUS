export const WATCH_PARTY_START_HOST_CHANNEL = "watch-party:start-host";
export const WATCH_PARTY_STOP_CHANNEL = "watch-party:stop";
export const WATCH_PARTY_JOIN_CHANNEL = "watch-party:join";
export const WATCH_PARTY_SEND_CHANNEL = "watch-party:send";
export const WATCH_PARTY_STATE_CHANNEL = "watch-party:state";
export const WATCH_PARTY_LIST_ADDRESSES_CHANNEL = "watch-party:list-addresses";

/** Main -> renderer push events (the app's first; every other context is invoke-only). */
export const WATCH_PARTY_STATUS_EVENT = "watch-party:status-event";
export const WATCH_PARTY_MESSAGE_EVENT = "watch-party:message-event";

export const WATCH_PARTY_GET_DISPLAY_NAME_CHANNEL = "watch-party:get-display-name";
export const WATCH_PARTY_SET_DISPLAY_NAME_CHANNEL = "watch-party:set-display-name";

/**
 * Open/close a listening socket so Windows offers its inbound-firewall prompt.
 * Peer-to-peer needs inbound UDP, which is dropped without the rule that prompt
 * creates.
 */
export const WATCH_PARTY_WARM_INBOUND_CHANNEL = "watch-party:warm-inbound";
export const WATCH_PARTY_STOP_WARM_CHANNEL = "watch-party:stop-warm";
