// The desktop's Mobile device link dialog: turns devices on the player's network on or off, shows the code a
// device scans to connect, and lists paired devices to rename or remove. The host owns all of it and reports
// its state; this only shows that state and passes on the player's choices.
import { elements } from "./dom.mjs";
import { host } from "./state.mjs";

let state = null;
let expiry = 0;

export function initDevices() {
  if (!host.devices) return;
  elements["open-devices"].hidden = false;
  elements["devices-separator"].hidden = false;
  elements["open-devices"].addEventListener("click", () => {
    host.devicesOpen();
    elements["devices-dialog"].showModal();
  });
  elements["devices-dialog"].addEventListener("close", () => { if (state?.pairing) host.devicesPairStop(); });
  elements["devices-enabled"].addEventListener("change", () => host.devicesEnable(elements["devices-enabled"].checked));
  elements["devices-connect"].addEventListener("click", () => host.devicesPair());
  elements["devices-address"].addEventListener("change", () => host.devicesPair(elements["devices-address"].value));
  host.on("devices-state", (next) => {
    state = next;
    render();
  });
}

function render() {
  const { enabled, running, error, addresses = [], devices = [], pairing } = state;
  elements["devices-enabled"].checked = enabled === true;
  elements["devices-error"].hidden = !error && !(running && !addresses.length);
  elements["devices-error"].textContent = error || "This computer isn't connected to a network that phones can reach.";
  elements["devices-connect"].hidden = !running || !addresses.length || Boolean(pairing);
  elements["devices-pairing"].hidden = !pairing;
  // When the code runs out, the host's fresh state takes it away.
  clearTimeout(expiry);
  if (pairing) expiry = setTimeout(() => host.devicesOpen(), Math.max(0, Date.parse(pairing.expires) - Date.now()) + 500);
  if (pairing) {
    elements["devices-qr"].src = pairing.qr;
    elements["devices-url"].textContent = pairing.url.replace(/#.*$/, "");
    elements["devices-code"].textContent = pairing.code;
    elements["devices-address-row"].hidden = addresses.length < 2;
    elements["devices-address"].replaceChildren(...addresses.map((address) => new Option(address, address, false, address === pairing.address)));
  }
  elements["devices-list"].replaceChildren(...devices.map(deviceRow));
}

function deviceRow(device) {
  const row = document.createElement("li");
  const name = document.createElement("input");
  name.value = device.name;
  name.maxLength = 40;
  name.setAttribute("aria-label", "Device name");
  name.addEventListener("change", () => host.devicesRename(device.id, name.value));
  const status = document.createElement("span");
  status.textContent = device.connected ? "Connected" : `Last seen ${new Date(device.lastSeen).toLocaleDateString()}`;
  status.classList.toggle("connected", device.connected === true);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-text";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => host.devicesRemove(device.id));
  row.append(name, status, remove);
  return row;
}
