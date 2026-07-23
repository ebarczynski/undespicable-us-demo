export function connect(onMessage) {
  const url = `ws://${location.host}/ws`;
  let socket;
  let reconnectDelay = 500;

  function open() {
    socket = new WebSocket(url);
    socket.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data));
      } catch (err) {
        console.error("bad ws message", err);
      }
    };
    socket.onopen = () => {
      reconnectDelay = 500;
    };
    socket.onclose = () => {
      setTimeout(open, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 5000);
    };
    socket.onerror = () => socket.close();
  }
  open();

  return {
    send(obj) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
    },
  };
}
