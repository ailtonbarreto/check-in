const map = L.map('map', {
    zoomControl: false
}).setView([-23.5505, -46.6333], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

const toast = document.getElementById('toast');
const destinationInput = document.getElementById('destination');
const suggestionList = document.getElementById('autocomplete-list');
const greeting = document.getElementById('greeting');
let toastTimeout;
let locationMarker;
let destinationMarker;
let routeLine;
let currentPosition = null;
const driverMarkers = new Map();
const driverIcon = L.icon({
    iconUrl: 'car.png',
    iconSize: [42, 42],
    iconAnchor: [21, 21]
});
let suggestionTimeout;
let suggestionController;
let activeSuggestionRequest = 0;
let fetchingDrivers = false;

function atualizarSaudacao() {
    const hora = new Date().getHours();
    greeting.textContent = hora < 12 ? 'Bom dia!' : hora < 18 ? 'Boa tarde!' : 'Boa noite!';
}

function showMessage(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function clearSuggestions() {
    activeSuggestionRequest++;
    if (suggestionController) {
        suggestionController.abort();
        suggestionController = null;
    }
    suggestionList.replaceChildren();
    suggestionList.hidden = true;
}

async function buscarSugestoes(query, signal) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&bbox=-74,-34,-34,6&limit=50`;
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`A API de endereços respondeu com status ${response.status}.`);
    }

    const data = await response.json();
    if (!Array.isArray(data.features)) return [];

    const locations = data.features
        .filter((feature) => feature.properties.countrycode?.toUpperCase() === 'BR')
        .map((feature) => {
            const properties = feature.properties;
            return {
                name: [
                    properties.name,
                    properties.street,
                    properties.city,
                    properties.state,
                    properties.country
                ].filter(Boolean).join(', '),
                lat: feature.geometry.coordinates[1],
                lon: feature.geometry.coordinates[0]
            };
        })
        .filter((location) => location.name && Number.isFinite(location.lat) && Number.isFinite(location.lon));

    const seen = new Set();
    return locations.filter((location) => {
        const key = `${location.name.trim().toLowerCase()}|${location.lat.toFixed(5)},${location.lon.toFixed(5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 5);
}

function renderSuggestions(locations) {
    suggestionList.replaceChildren();
    locations.forEach((location) => {
        const item = document.createElement('button');
        item.className = 'autocomplete-item';
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.textContent = location.name;
        item.addEventListener('click', () => {
            destinationInput.value = location.name;
            clearSuggestions();
            criarRota(location).catch((error) => {
                console.error('Erro ao criar rota:', error);
                showMessage(error.message || 'Não foi possível criar a rota.');
            });
        });
        suggestionList.appendChild(item);
    });
    suggestionList.hidden = locations.length === 0;
}

function debounceSuggestions() {
    window.clearTimeout(suggestionTimeout);
    if (suggestionController) suggestionController.abort();

    const query = destinationInput.value.trim();
    clearSuggestions();
    if (query.length < 3) return;

    suggestionTimeout = window.setTimeout(async () => {
        const requestId = ++activeSuggestionRequest;
        suggestionController = new AbortController();
        try {
            const locations = await buscarSugestoes(query, suggestionController.signal);
            if (requestId === activeSuggestionRequest && destinationInput.value.trim() === query) {
                renderSuggestions(locations);
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Erro ao buscar sugestões de endereço:', error);
                if (requestId === activeSuggestionRequest) {
                    showMessage('Não foi possível buscar sugestões de endereço. Tente novamente.');
                }
            }
        }
    }, 220);
}

function obterLocalizacao() {
    if (currentPosition) return Promise.resolve(currentPosition);
    if (!navigator.geolocation) {
        return Promise.reject(new Error('A localização não está disponível neste dispositivo.'));
    }

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                currentPosition = [coords.latitude, coords.longitude];
                resolve(currentPosition);
            },
            () => reject(new Error('Não foi possível acessar sua localização. Verifique as permissões do navegador.')),
            { enableHighAccuracy: true, timeout: 12000 }
        );
    });
}

function mostrarLocalizacao(position, zoom = 16) {
    currentPosition = position;
    map.setView(position, zoom);
    if (locationMarker) map.removeLayer(locationMarker);
    locationMarker = L.circleMarker(position, {
        radius: 8,
        color: '#ffffff',
        weight: 4,
        fillColor: '#2878f0',
        fillOpacity: 1
    }).addTo(map);
}

async function plotarMotoristasNoMapa() {
    if (fetchingDrivers) return;
    fetchingDrivers = true;

    try {
        const response = await fetch('https://api-checkin-s376.onrender.com/localizacoes');
        if (!response.ok) {
            throw new Error(`A API de localizações respondeu com status ${response.status}.`);
        }

        const payload = await response.json();
        if (!Array.isArray(payload.data)) {
            throw new Error('A API de localizações retornou dados inválidos.');
        }

        const driverIds = new Set();
        payload.data.forEach((driver) => {
            const id = driver.pessoa;
            const latitude = Number(driver.lat);
            const longitude = Number(driver.lon);
            if (id === undefined || id === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return;
            }

            const key = String(id);
            driverIds.add(key);
            const position = [latitude, longitude];
            let marker = driverMarkers.get(key);

            if (marker) {
                marker.setLatLng(position);
            } else {
                const label = document.createElement('strong');
                label.textContent = String(id);
                marker = L.marker(position, { icon: driverIcon })
                    .bindPopup(label)
                    .addTo(map);
                driverMarkers.set(key, marker);
            }
        });

        driverMarkers.forEach((marker, id) => {
            if (!driverIds.has(id)) {
                map.removeLayer(marker);
                driverMarkers.delete(id);
            }
        });
    } catch (error) {
        console.error('Erro ao buscar localizações dos motoristas:', error);
    } finally {
        fetchingDrivers = false;
    }
}

async function resolverDestino(query) {
    const locations = await buscarSugestoes(query);
    const exactMatch = locations.find((location) => location.name.toLowerCase() === query.toLowerCase());
    const destination = exactMatch || locations[0];
    if (!destination) {
        throw new Error('Endereço não encontrado no Brasil. Confira o endereço e tente novamente.');
    }
    return destination;
}

async function criarRota(destination) {
    clearSuggestions();
    showMessage('Obtendo sua localização...');

    const origin = await obterLocalizacao();
    const url = `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`O serviço de rotas respondeu com status ${response.status}.`);
    }

    const data = await response.json();
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
        throw new Error('Não foi possível encontrar uma rota para esse endereço.');
    }

    if (routeLine) map.removeLayer(routeLine);
    if (destinationMarker) map.removeLayer(destinationMarker);
    if (locationMarker) map.removeLayer(locationMarker);

    const routeCoordinates = route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
    routeLine = L.polyline(routeCoordinates, {
        color: '#1869ab',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(map);

    destinationMarker = L.marker([destination.lat, destination.lon]).addTo(map);
    destinationMarker.bindPopup(destination.name);
    locationMarker = L.circleMarker(origin, {
        radius: 8,
        color: '#ffffff',
        weight: 4,
        fillColor: '#2878f0',
        fillOpacity: 1
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), { padding: [36, 36] });
    const distance = (route.distance / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const duration = Math.round(route.duration / 60);
    showMessage(`Rota de ${distance} km · cerca de ${duration} min`);
}

document.getElementById('menu-button').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const menu = document.getElementById('menu');
    const isExpanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!isExpanded));
    menu.hidden = isExpanded;
});

document.getElementById('location-button').addEventListener('click', () => {
    obterLocalizacao()
        .then((position) => mostrarLocalizacao(position))
        .catch((error) => {
            console.error('Erro ao obter localização:', error);
            showMessage(error.message);
        });
});

destinationInput.addEventListener('input', debounceSuggestions);

document.addEventListener('click', (event) => {
    if (!document.getElementById('destination-form').contains(event.target)) {
        clearSuggestions();
    }
});

document.querySelectorAll('.place').forEach((place) => {
    place.addEventListener('click', () => {
        document.getElementById('destination').value = place.dataset.destination;
        document.getElementById('destination').focus();
    });
});

document.getElementById('destination-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const destinationText = destinationInput.value.trim();
    if (!destinationText) {
        showMessage('Digite um endereço para traçar a rota.');
        destinationInput.focus();
        return;
    }

    resolverDestino(destinationText)
        .then(criarRota)
        .catch((error) => {
            console.error('Erro ao buscar o endereço ou criar rota:', error);
            showMessage(error.message || 'Não foi possível criar a rota.');
        });
});

document.getElementById('schedule-button').addEventListener('click', () => {
    showMessage('O agendamento de viagens estará disponível em breve.');
});

document.querySelectorAll('.nav-option').forEach((option) => {
    option.addEventListener('click', () => {
        document.querySelectorAll('.nav-option').forEach((item) => {
            const selected = item === option;
            item.classList.toggle('is-active', selected);
            item.setAttribute('aria-pressed', String(selected));
        });

        if (option.dataset.category === 'food') {
            showMessage('A opção de comidas estará disponível em breve.');
        }
    });
});

atualizarSaudacao();
plotarMotoristasNoMapa();
window.setInterval(plotarMotoristasNoMapa, 3000);

obterLocalizacao()
    .then((position) => mostrarLocalizacao(position))
    .catch((error) => {
        console.error('Erro ao obter localização ao carregar a home:', error);
        showMessage(error.message);
    });