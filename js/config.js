export const CONFIG = {
  appName: 'Now Here',
  repo: 'jkh2/live-cam-streamer',                 // used for "report a camera" links
  textures: 'https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/',
  tourSeconds: 40,                                 // Follow the Sun / Wander dwell time
  maxWall: 9,
};

export const CATEGORIES = {
  city:       { label: 'Cities',     color: '#7cc4ff' },
  nature:     { label: 'Nature',     color: '#7dffb0' },
  wildlife:   { label: 'Wildlife',   color: '#ffd36b' },
  beach:      { label: 'Beaches',    color: '#5ff0e6' },
  port:       { label: 'Harbors',    color: '#a3aaff' },
  mountain:   { label: 'Mountains',  color: '#e6eeff' },
  rail:       { label: 'Rail',       color: '#ff9f5a' },
  aviation:   { label: 'Airports',   color: '#ff6fae' },
  sky:        { label: 'Night sky',  color: '#c88bff' },
  underwater: { label: 'Underwater', color: '#3fd0ff' },
  discovered: { label: 'Discovered', color: '#ffffff' },
};
