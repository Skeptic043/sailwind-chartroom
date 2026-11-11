// The chart details, island library and boat library dialogs.
import { boatColours } from "./render.mjs";
import { mapPalette } from "./theme.mjs";
import { createChart } from "./model.mjs";
import { ISLAND_CATALOG, searchIsland, visibleIsland } from "./islands.mjs";
import { BOAT_CATALOG, assignedBoat, boatMarkerSize, drawBoatSilhouette } from "./boats.mjs";
import { elements, showToast } from "./dom.mjs";
import { activeChart, commit, host, persist, pushUndo, resetHistory, selectedItem, selection, workspace } from "./state.mjs";
import { placeIsland } from "./interaction.mjs";
import { renderEverything } from "./panels.mjs";

let dialogMode = "new";

export function openChartDialog(nextMode) {
  dialogMode = nextMode;
  const chart = activeChart();
  elements["chart-dialog-title"].textContent = nextMode === "new" ? "New scrambled sea" : "Chart details";
  elements["dialog-chart-name"].value = nextMode === "new" ? `Scrambled Sea ${workspace.charts.length + 1}` : chart.name;
  elements["dialog-chart-seed"].value = nextMode === "new" ? "" : chart.seed;
  elements["delete-chart"].hidden = nextMode === "new";
  elements["chart-dialog"].showModal();
  window.setTimeout(() => elements["dialog-chart-name"].select(), 0);
}

export function saveChartDialog(event) {
  event.preventDefault();
  const name = elements["dialog-chart-name"].value.trim();
  const seed = elements["dialog-chart-seed"].value.trim();
  if (!name) return;
  if (dialogMode === "new") {
    const chart = createChart({ name, seed });
    workspace.charts.push(chart);
    workspace.activeChartId = chart.id;
    resetHistory();
  } else {
    pushUndo();
    activeChart().name = name;
    activeChart().seed = seed;
    activeChart().updatedAt = new Date().toISOString();
  }
  persist();
  elements["chart-dialog"].close();
  renderEverything();
}

export function deleteChart() {
  if (workspace.charts.length === 1) {
    showToast("Keep at least one chart. Clear its contents instead.", true);
    return;
  }
  if (!window.confirm(`Delete “${activeChart().name}” from Chartroom? Export it first if you may need it later.`)) return;
  workspace.charts = workspace.charts.filter((chart) => chart.id !== workspace.activeChartId);
  workspace.activeChartId = workspace.charts[0].id;
  resetHistory();
  elements["chart-dialog"].close();
  persist(); renderEverything();
}

// A location or a search area can carry an island outline.
export function selectedIslandOwner() {
  return selection && (selection.kind === "feature" || selection.kind === "search") ? selectedItem() : null;
}

export function openIslandLibrary() {
  const owner = selectedIslandOwner();
  elements["island-dialog-hint"].textContent = !owner
    ? "Choose an island, then click its position on the chart."
    : selection.kind === "search"
      ? `Show the island “${owner.label || "this search area"}” is looking for. It appears at the search centre and carries into the resolved location.`
      : `Apply an outline to “${owner.name || "this location"}”. Its coordinates and notes will stay unchanged.`;
  if (elements["island-region"].options.length === 1) {
    const regions = [...new Set(ISLAND_CATALOG.map((island) => island.region))].sort();
    elements["island-region"].append(...regions.map((region) => {
      const option = document.createElement("option");
      option.value = region;
      option.textContent = region;
      return option;
    }));
  }
  elements["island-search"].value = "";
  elements["island-region"].value = "all";
  renderIslandLibrary();
  elements["island-dialog"].showModal();
  window.setTimeout(() => elements["island-search"].focus(), 0);
}

export function renderIslandLibrary() {
  const query = elements["island-search"].value.trim().toLowerCase();
  const region = elements["island-region"].value;
  const showSecrets = elements["island-secrets"].checked;
  const owner = selectedIslandOwner();
  const current = selection?.kind === "search" ? searchIsland(owner) : visibleIsland(owner);
  elements["remove-island"].hidden = !owner;
  elements["remove-island"].disabled = !current;
  const islands = ISLAND_CATALOG.filter((island) => (showSecrets || !island.secret)
    && (region === "all" || island.region === region)
    && `${island.name} ${island.region}`.toLowerCase().includes(query));
  elements["island-list"].replaceChildren(...islands.map((island) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `island-row${current?.id === island.id ? " active" : ""}`;
    const preview = document.createElement("canvas");
    preview.width = 108;
    preview.height = 84;
    const text = document.createElement("span");
    const name = document.createElement("strong");
    const detail = document.createElement("small");
    name.textContent = island.name;
    detail.textContent = `${island.region}${island.secret ? " · secret" : ""}`;
    if (island.secret) detail.className = "secret";
    text.append(name, detail);
    button.append(preview, text);
    drawIslandPreview(preview, island);
    button.addEventListener("click", () => {
      const selectedOwner = selectedIslandOwner();
      if (selectedOwner) {
        commit(() => {
          selectedOwner.islandId = island.id;
          selectedOwner.showIsland = true;
        });
      } else {
        placeIsland(island);
      }
      elements["island-dialog"].close();
    });
    return button;
  }));
  if (!islands.length) {
    const empty = document.createElement("p");
    empty.className = "fineprint";
    empty.textContent = "No islands match these filters.";
    elements["island-list"].append(empty);
  }
}

function drawIslandPreview(canvasElement, island) {
  const preview = canvasElement.getContext("2d");
  const width = canvasElement.width;
  const height = canvasElement.height;
  const palette = mapPalette();
  preview.fillStyle = palette.preview;
  preview.fillRect(0, 0, width, height);
  const spanLon = Math.max(.0001, island.bounds.maxLon - island.bounds.minLon);
  const spanLat = Math.max(.0001, island.bounds.maxLat - island.bounds.minLat);
  const scale = Math.min((width - 14) / spanLon, (height - 14) / spanLat);
  const centreLon = (island.bounds.minLon + island.bounds.maxLon) / 2;
  const centreLat = (island.bounds.minLat + island.bounds.maxLat) / 2;
  const fills = palette.islandFills;
  for (const shape of island.shapes) {
    preview.beginPath();
    for (const ring of shape.rings) {
      for (let index = 0; index < ring.length; index += 2) {
        const x = width / 2 + (ring[index] - centreLon) * scale;
        const y = height / 2 - (ring[index + 1] - centreLat) * scale;
        if (index) preview.lineTo(x, y); else preview.moveTo(x, y);
      }
      preview.closePath();
    }
    preview.fillStyle = fills[shape.kind] ?? fills[0];
    preview.fill("evenodd");
    preview.strokeStyle = palette.previewLine;
    preview.lineWidth = 1;
    preview.stroke();
  }
}

export function openBoatLibrary() {
  const owner = selectedBoatOwner();
  if (!owner) {
    showToast("Select a location or search area before assigning a boat.", true);
    return;
  }
  const name = selection.kind === "search" ? owner.label || "this search area" : owner.name;
  elements["boat-dialog-hint"].textContent = selection.kind === "search"
    ? `Mark the boat expected near “${name}”. It appears at the search centre and carries into the resolved location.`
    : `Mark the boat currently at “${name}”. The location and island outline stay unchanged.`;
  if (elements["boat-provider"].options.length === 1) {
    const providers = [...new Set(BOAT_CATALOG.map((boat) => boat.provider))]
      .sort((a, b) => a === "Vanilla" ? -1 : b === "Vanilla" ? 1 : a.localeCompare(b));
    elements["boat-provider"].append(...providers.map((provider) => {
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = provider;
      return option;
    }));
  }
  elements["boat-search"].value = "";
  elements["boat-provider"].value = "all";
  renderBoatLibrary();
  elements["boat-dialog"].showModal();
  window.setTimeout(() => elements["boat-search"].focus(), 0);
}

export function renderBoatLibrary() {
  const query = elements["boat-search"].value.trim().toLowerCase();
  const provider = elements["boat-provider"].value;
  const owner = selectedBoatOwner();
  const current = assignedBoat(owner);
  const boats = BOAT_CATALOG.filter((boat) => (provider === "all" || boat.provider === provider)
    && `${boat.name} ${boat.provider} ${boat.size}`.toLowerCase().includes(query));
  elements["remove-boat"].disabled = !current;
  elements["boat-list"].replaceChildren(...boats.map((boat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `boat-row${current?.id === boat.id ? " active" : ""}`;
    const preview = document.createElement("canvas");
    preview.width = 132;
    preview.height = 72;
    const text = document.createElement("span");
    const name = document.createElement("strong");
    const detail = document.createElement("small");
    name.textContent = boat.name;
    detail.textContent = `${boat.provider} · ${boat.size}`;
    text.append(name, detail);
    button.append(preview, text);
    drawBoatPreview(preview, boat);
    button.addEventListener("click", () => {
      const selectedOwner = selectedBoatOwner();
      if (!selectedOwner) return;
      commit(() => {
        selectedOwner.boatId = boat.id;
        selectedOwner.boatCorner = "se";
        selectedOwner.showBoat = true;
      });
      elements["boat-dialog"].close();
    });
    return button;
  }));
  if (!boats.length) {
    const empty = document.createElement("p");
    empty.className = "fineprint";
    empty.textContent = "No boats match these filters.";
    elements["boat-list"].append(empty);
  }
}

export function selectedBoatOwner() {
  return selection && (selection.kind === "feature" || selection.kind === "search") ? selectedItem() : null;
}

function drawBoatPreview(canvasElement, boat) {
  const preview = canvasElement.getContext("2d");
  const palette = mapPalette();
  preview.fillStyle = palette.preview;
  preview.fillRect(0, 0, canvasElement.width, canvasElement.height);
  const marker = boatMarkerSize(boat);
  drawBoatSilhouette(preview, boat, {
    x: canvasElement.width / 2,
    y: canvasElement.height / 2 + 2,
    width: marker.width * 2,
    height: marker.height * 2
  }, { ...boatColours(palette, false), lineWidth: 1.6 });
}

// The license texts ship inside the app, so a copied exe still carries its notices.
let noticesLoaded = false;

export async function openAbout() {
  elements["about-version"].textContent = host.version;
  elements["about-dialog"].showModal();
  if (noticesLoaded) return;
  const read = async (path) => {
    const response = await fetch(path);
    return response.ok ? response.text() : "";
  };
  const [license, notices] = await Promise.all([read("LICENSE.txt"), read("THIRD-PARTY-NOTICES.txt")]);
  elements["about-license"].textContent = license;
  elements["about-notices"].textContent = notices;
  noticesLoaded = Boolean(license && notices);
}
