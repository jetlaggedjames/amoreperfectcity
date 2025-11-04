/* --- CONFIG --- */
/* Set this to your proxy base URL (where server.js is hosted).
   If you deployed the Node proxy to https://myproxy.example.com set it here.
   If you don't want to run a proxy, you can try leaving it blank and some browsers
   will access MTA endpoints directly (may be blocked by CORS). */
const PROXY_BASE = "https://YOUR_PROXY_HERE"; // <-- REPLACE with your proxy or leave "" to try direct feed
const POLL_INTERVAL_MS = 9000; // how frequently to poll (ms)
const STATION_SOURCE = "https://data.ny.gov/resource/5f5g-n3cz.json?borough=Manhattan";

/* MTA subway line colors (subset) */
const LINE_COLORS = {
  '1':'#EE352E','2':'#EE352E','3':'#EE352E',
  '4':'#00933C','5':'#00933C','6':'#00933C',
  'A':'#2850AD','C':'#2850AD','E':'#2850AD',
  'B':'#FF6319','D':'#FF6319','F':'#FF6319','M':'#FF6319',
  'N':'#FCCC0A','Q':'#FCCC0A','R':'#FCCC0A','W':'#FCCC0A',
  'G':'#6CBE45','L':'#A7A9AC','7':'#B933AD','S':'#808183'
};

/* --- END CONFIG --- */

let map, stationsLayer;
let stations = {}; // stop_id -> station object
let vehicles = []; // latest vehicles
let tripUpdates = []; // latest trip updates

document.getElementById('year').textContent = new Date().getFullYear();
document.getElementById('closePanel').addEventListener('click', ()=>document.getElementById('panel').classList.add('hidden'));

async function init(){
  // initialize map
  map = L.map('map', {zoomControl:false, attributionControl:false}).setView([40.7736, -73.9712], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

  // station layer group
  stationsLayer = L.layerGroup().addTo(map);

  // load station list (Manhattan)
  await loadStations();

  // initial fetch live
  await fetchLive();

  // poll
  setInterval(fetchLive, POLL_INTERVAL_MS);
}

async function loadStations(){
  try {
    const resp = await fetch(STATION_SOURCE);
    if (!resp.ok) throw new Error('stations fetch failed');
    const data = await resp.json();

    // Socrata format varies; we expect fields: gtfs_stop_id, stop_name, location.latitude, location.longitude, complex_name, routes (string like "1,2,3,A,C")
    data.forEach(s => {
      // prefer gtfs_stop_id or stop_id
      const stopId = s.gtfs_stop_id || s.stop_id || s.locationid || s.stop_id0 || s.id || s['stop_id'];
      const lat = (s.the_geom && s.the_geom.coordinates)? s.the_geom.coordinates[1] : (s.location && s.location.latitude) || s.latitude || s.stop_lat;
      const lon = (s.the_geom && s.the_geom.coordinates)? s.the_geom.coordinates[0] : (s.location && s.location.longitude) || s.longitude || s.stop_lon;
      if (!stopId || !lat || !lon) return;
      const name = s.station_name || s.stop_name || s['station'];
      const routes = (s.routes || s.services || s['route_id'] || s['lines'] || "").toString();

      stations[stopId] = {
        id: stopId,
        name: name || "Unknown",
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        routes: routes.split(/\s*[,;\/]\s*/).filter(Boolean),
        marker: null
      };
    });

    // draw markers
    Object.values(stations).forEach(st => {
      const color = pickStationColor(st.routes);
      const el = L.divIcon({
        className: '',
        html: `<div class="station-dot" style="background:${color}"></div>`,
        iconSize: [14,14],
        iconAnchor: [7,7]
      });
      const m = L.marker([st.lat, st.lon], {icon:el}).addTo(stationsLayer);
      m.on('click', ()=>openStationPanel(st.id));
      st.marker = m;
    });

    // fit to Manhattan bounds (approx)
    const bounds = [[40.700292, -74.0219],[40.880066, -73.9067]];
    map.fitBounds(bounds, {padding:[30,30]});
  } catch (err) {
    console.error('loadStations error', err);
    alert('Could not load stations automatically. If this happens, check the STATION_SOURCE or CORS. I can provide an embedded fallback if needed.');
  }
}

function pickStationColor(routes){
  // pick first route with known color
  for (let r of routes){
    const k = r.trim().toUpperCase();
    if (LINE_COLORS[k]) return LINE_COLORS[k];
    if (k.length && LINE_COLORS[k[0]]) return LINE_COLORS[k[0]];
  }
  return '#ffffff';
}

async function fetchLive(){
  // fetch vehicle positions & trip updates from proxy
  try {
    const vpUrl = (PROXY_BASE? `${PROXY_BASE}/vehiclePositions` : '/vehiclePositions');
    const tuUrl = (PROXY_BASE? `${PROXY_BASE}/tripUpdates` : '/tripUpdates');

    // fetch in parallel
    const [vResp, tResp] = await Promise.all([
      fetch(vpUrl).then(r=>r.ok? r.json(): Promise.reject('vp fail')),
      fetch(tuUrl).then(r=>r.ok? r.json(): Promise.reject('tu fail'))
    ]);

    vehicles = vResp.vehicles || [];
    tripUpdates = tResp.tripUpdates || [];

    // mark stations lit if vehicles at same stop_id or within 30m
    const now = Date.now();
    const stationLit = new Set();

    for (const veh of vehicles){
      // veh likely has stop_id if stopped; otherwise has position {lat,lon}
      if (veh.stop_id) stationLit.add(veh.stop_id);
      else if (veh.position){
        // check proximity
        Object.values(stations).forEach(st=>{
          const d = distanceMeters(veh.position.lat,veh.position.lon, st.lat, st.lon);
          if (d < 40) stationLit.add(st.id);
        });
      }
    }

    // update markers visuals
    Object.values(stations).forEach(st=>{
      const el = st.marker.getElement?.() || st.marker._icon;
      if (!el) return;
      const dot = el.querySelector('.station-dot');
      if (!dot) return;
      if (stationLit.has(st.id)){
        dot.classList.add('lit');
      } else dot.classList.remove('lit');
    });

    // update last updated time
    document.getElementById('lastUpdated').textContent = 'updated: ' + (new Date()).toLocaleTimeString();
  } catch (err){
    console.warn('fetchLive issue', err);
  }
}

function distanceMeters(lat1,lon1,lat2,lon2){
  const R = 6371000;
  const toRad = (d)=>d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  return R*c;
}

function openStationPanel(stopId){
  const st = stations[stopId];
  if (!st) return;
  document.getElementById('panel').classList.remove('hidden');
  document.getElementById('stationName').textContent = st.name;
  const linesDiv = document.getElementById('stationLines');
  linesDiv.innerHTML = '';
  st.routes.forEach(r=>{
    const color = LINE_COLORS[r] || '#777';
    const el = document.createElement('div');
    el.className = 'station-line';
    el.style.background = color;
    el.textContent = r;
    linesDiv.appendChild(el);
  });

  // prepare next 3 arrivals using tripUpdates: find updates whose stop_time_updates include this stopId
  const arrivals = [];
  tripUpdates.forEach(tu=>{
    (tu.stop_time_updates || []).forEach(stu=>{
      if (stu.stop_id === stopId){
        // arrival or departure time in epoch seconds
        const t = (stu.arrival && stu.arrival.time) || (stu.departure && stu.departure.time) || stu.time;
        if (t) arrivals.push({route: tu.route || tu.trip && tu.trip.route_id || '?', when: +t});
      }
    });
  });

  // sort by time, take 3
  arrivals.sort((a,b)=>a.when - b.when);
  const next = arrivals.slice(0,3);

  renderSplitFlap(next, st);
}

/* simple split-flap renderer */
function renderSplitFlap(nextArrivals, station){
  const container = document.getElementById('splitFlap');
  container.innerHTML = '';
  for (let i=0;i<3;i++){
    const row = document.createElement('div');
    row.className = 'row';
    const left = document.createElement('div');
    left.className = 'left';
    const circle = document.createElement('div');
    circle.className = 'circle';
    if (nextArrivals[i]) {
      const r = nextArrivals[i].route;
      circle.style.background = LINE_COLORS[r] || '#222';
      circle.textContent = r;
      left.appendChild(circle);
      const label = document.createElement('div');
      const when = nextArrivals[i].when*1000;
      const dt = Math.max(0, Math.round((when - Date.now())/60000));
      label.innerHTML = `<div style="font-size:14px">${station.name}</div><div style="font-size:12px;color:#d1d5db">${dt===0?'now':dt+' min'}</div>`;
      left.appendChild(label);

      const right = document.createElement('div');
      right.style.fontVariantNumeric = 'tabular-nums';
      right.textContent = new Date(when).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      row.appendChild(left);
      row.appendChild(right);
    } else {
      circle.style.background = '#444';
      circle.textContent = '—';
      left.appendChild(circle);
      const label = document.createElement('div');
      label.innerHTML = `<div style="font-size:14px">No data</div><div style="font-size:12px;color:#d1d5db">—</div>`;
      left.appendChild(label);
      const right = document.createElement('div');
      right.textContent = '--:--';
      row.appendChild(left); row.appendChild(right);
    }
    container.appendChild(row);
  }
}

/* start */
init();
