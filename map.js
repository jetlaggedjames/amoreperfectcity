mapboxgl.accessToken = 'pk.eyJ1IjoiamV0bGFnZ2VkamFtZXMiLCJhIjoiY21oanJwZ244MHMxNjJrcHRucXhqOTVxcSJ9.nfLmhdszFPSGvSMhI1Ipfw';
let darkMode = false;
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-74.006,40.7128],
  zoom: 10.2,
  pitch: 35,
  bearing: -20,
  antialias: true
});

// Load boroughs
map.on('load', async () => {
  const res = await fetch('boroughs.json');
  const geo = await res.json();
  
  // Initialize color if not set
  geo.features.forEach(f => f.properties.color = f.properties.color || '#aaaaaa');
  
  map.addSource('boroughs', { type: 'geojson', data: geo });
  
  // Fill layer
  map.addLayer({
    id: 'borough-fills',
    type: 'fill-extrusion',
    source: 'boroughs',
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': 50,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.85
    }
  });

  // Lines
  map.addLayer({
    id: 'borough-lines',
    type: 'line',
    source: 'boroughs',
    paint: { 'line-color': '#fff', 'line-width': 1.5 }
  });

  // Animate borough updates every 5s (demo/fake updates)
  setInterval(() => {
    geo.features.forEach(f => {
      // random color for demo
      f.properties.color = '#' + Math.floor(Math.random()*16777215).toString(16);
    });
    map.getSource('boroughs').setData(geo);
  }, 5000);
});

// Light/Dark toggle
document.getElementById('mode-toggle').onclick = () => {
  darkMode = !darkMode;
  document.body.className = darkMode ? 'dark' : 'light';
  map.setStyle(darkMode ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11');
};
