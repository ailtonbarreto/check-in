document.addEventListener("DOMContentLoaded", function () {

    const statusDiv = document.getElementById("status");
    const inputDestino = document.getElementById("destino-input");
    const lista = document.getElementById("autocomplete-list");
    const btnIr = document.getElementById("btn-ir");

    // ============================
    // AUTOCOMPLETE (Photon)
    // ============================
    async function buscarSugestoes(query) {
        if (!query || query.length < 3) return [];

        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;

        try {
            const resp = await fetch(url);
            const dados = await resp.json();

            return dados.features.map(f => ({
                display_name: [
                    f.properties.name,
                    f.properties.street,
                    f.properties.city,
                    f.properties.state,
                    f.properties.country
                ].filter(Boolean).join(", "),
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0]
            }));
        } catch (e) {
            console.error("Erro ao buscar sugestões:", e);
            return [];
        }
    }

    // debounce simples para evitar muitas requisições
    let debounceTimer = null;
    inputDestino.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const texto = inputDestino.value.trim();
            lista.innerHTML = "";
            if (texto.length < 3) return;
            const sugestoes = await buscarSugestoes(texto);
            sugestoes.forEach(s => {
                const item = document.createElement("div");
                item.className = "autocomplete-item";
                item.textContent = s.display_name;
                item.addEventListener("click", () => {
                    inputDestino.value = s.display_name;
                    lista.innerHTML = "";
                    destinoFixo = { lat: parseFloat(s.lat), lon: parseFloat(s.lon) };
                    calcularRota();
                });
                lista.appendChild(item);
            });
        }, 220);
    });

    // ============================
    // Aguarda MapLibre carregado
    // ============================
    function whenMapLibreReady(cb, timeout = 5000) {
        const start = Date.now();
        (function check() {
            if (typeof maplibregl !== "undefined") return cb();
            if (Date.now() - start > timeout) {
                statusDiv.textContent = "Erro: biblioteca de mapas não carregou.";
                return;
            }
            setTimeout(check, 100);
        })();
    }

    whenMapLibreReady(initMap);

    // ============================
    // MAPA (MapLibre GL JS) - JS completo
    // ============================
    function initMap() {

        const mapContainer = document.getElementById("map");

        const map = new maplibregl.Map({
            container: mapContainer,
            style: {
                version: 8,
                sources: {
                    osm: {
                        type: "raster",
                        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                        tileSize: 256,
                        attribution: "© OpenStreetMap"
                    }
                },
                layers: [
                    { id: "osm-layer", type: "raster", source: "osm" }
                ]
            },
            center: [-51.9253, -14.2350],
            zoom: 4,
            pitch: 0,
            bearing: 0
        });

        // estado
        let marker = null; // não usado para user marker (mantido por compatibilidade)
        let primeiraAtualizacao = true;
        let ultimaLatitude = null;
        let ultimaLongitude = null;
        let watchId = null;

        let destinoFixo = null;
        let destinoMarker = null;
        let rotaGeoJSON = null;
        let rotaLatLngs = [];

        // user marker DOM (carro)
        let userMarker = null;
        let ultimaPosParaRotacao = null;

        // adiciona fonte/layer para rota
        map.on("load", () => {
            map.addSource("rota", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
            map.addLayer({
                id: "rota-line",
                type: "line",
                source: "rota",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: { "line-color": "#1976d2", "line-width": 5 }
            });
        });

        // ============================
        // UTIL: bearing entre dois pontos
        // ============================
        function calcularBearing(lat1, lon1, lat2, lon2) {
            const toRad = deg => deg * Math.PI / 180;
            const toDeg = rad => rad * 180 / Math.PI;

            const φ1 = toRad(lat1);
            const φ2 = toRad(lat2);
            const Δλ = toRad(lon2 - lon1);

            const y = Math.sin(Δλ) * Math.cos(φ2);
            const x = Math.cos(φ1) * Math.sin(φ2) -
                Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

            let θ = Math.atan2(y, x);
            return (toDeg(θ) + 360) % 360;
        }

        // ============================
        // PONTO MAIS PRÓXIMO NA ROTA
        // ============================
        function pontoMaisProximo(lat, lon) {
            let melhor = 0;
            let menorDist = Infinity;
            for (let i = 0; i < rotaLatLngs.length; i++) {
                const dx = rotaLatLngs[i][0] - lat;
                const dy = rotaLatLngs[i][1] - lon;
                const dist = dx * dx + dy * dy;
                if (dist < menorDist) {
                    menorDist = dist;
                    melhor = i;
                }
            }
            return melhor;
        }

        // ============================
        // ORIENTAR MAPA PELA ROTA (nativo)
        // ============================
        function orientarPelaRota(lat, lon) {
            if (rotaLatLngs.length < 2) return;
            const idx = pontoMaisProximo(lat, lon);
            const proxIdx = Math.min(idx + 1, rotaLatLngs.length - 1);
            const prox = rotaLatLngs[proxIdx];
            const bearing = calcularBearing(lat, lon, prox[0], prox[1]);
            map.rotateTo(bearing, { duration: 220 });
        }

        // ============================
        // GEOCODIFICAÇÃO (PHOTON)
        // ============================
        async function geocodificarEndereco(endereco) {
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(endereco)}&limit=1`;
            try {
                const resp = await fetch(url);
                const dados = await resp.json();
                if (!dados.features || dados.features.length === 0) {
                    alert("Endereço não encontrado.");
                    return null;
                }
                const f = dados.features[0];
                return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
            } catch (err) {
                console.error("Erro ao geocodificar:", err);
                alert("Erro ao buscar endereço.");
                return null;
            }
        }

        // ============================
        // DISTÂNCIA E SAÍDA DA ROTA
        // ============================
        function distanciaEmMetros(lat1, lon1, lat2, lon2) {
            const R = 6371000;
            const toRad = deg => deg * Math.PI / 180;
            const φ1 = toRad(lat1);
            const φ2 = toRad(lat2);
            const Δφ = toRad(lat2 - lat1);
            const Δλ = toRad(lon2 - lon1);
            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        function estaForaDaRota(lat, lon, limite = 30) {
            if (rotaLatLngs.length === 0) return true;
            let menorDist = Infinity;
            for (let i = 0; i < rotaLatLngs.length; i++) {
                const dist = distanciaEmMetros(lat, lon, rotaLatLngs[i][0], rotaLatLngs[i][1]);
                if (dist < menorDist) menorDist = dist;
            }
            return menorDist > limite;
        }

        // ============================
        // BOTÃO IR
        // ============================
        btnIr.addEventListener("click", async () => {
            const texto = inputDestino.value.trim();
            lista.innerHTML = "";
            if (texto === "") {
                alert("Digite um destino.");
                return;
            }
            const destino = await geocodificarEndereco(texto);
            if (!destino) return;
            destinoFixo = destino;
            if (destinoMarker) destinoMarker.remove();
            destinoMarker = new maplibregl.Marker().setLngLat([destino.lon, destino.lat]).addTo(map);
            calcularRota();
        });

        // ============================
        // CALCULAR ROTA (OSRM)
        // ============================
        async function calcularRota() {
            if (!ultimaLatitude || !ultimaLongitude) {
                statusDiv.textContent = "Aguardando localização...";
                return;
            }
            if (!destinoFixo) {
                statusDiv.textContent = "Digite um destino.";
                return;
            }
            const url = `https://router.project-osrm.org/route/v1/driving/${ultimaLongitude},${ultimaLatitude};${destinoFixo.lon},${destinoFixo.lat}?overview=full&geometries=geojson`;
            try {
                const response = await fetch(url);
                const data = await response.json();
                const coords = data.routes[0].geometry.coordinates; // [lon, lat]
                rotaLatLngs = coords.map(c => [c[1], c[0]]); // [lat, lon]
                rotaGeoJSON = {
                    type: "FeatureCollection",
                    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords } }]
                };
                if (map.getSource("rota")) {
                    map.getSource("rota").setData(rotaGeoJSON);
                }
                map.easeTo({ center: [ultimaLongitude, ultimaLatitude], zoom: 17, duration: 300 });
                statusDiv.textContent = "Rota calculada";
            } catch (err) {
                console.error("Erro ao calcular rota:", err);
                statusDiv.textContent = "Erro ao calcular rota";
            }
        }

        // ============================
        // MARKER DO CARRO (DOM) E ROTAÇÃO DO ÍCONE
        // ============================
        // cria elemento DOM do carro
        function criarCarMarker() {
            const el = document.createElement("div");
            el.className = "car-marker";
            el.style.width = "44px";
            el.style.height = "44px";
            el.style.display = "flex";
            el.style.alignItems = "center";
            el.style.justifyContent = "center";
            el.style.pointerEvents = "none";
            el.style.transformOrigin = "center center";

            el.innerHTML = `
              <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <g fill="none" fill-rule="evenodd">
                  <rect width="64" height="64" rx="8" fill="transparent"/>
                  <path d="M10 36 L54 36 L54 44 C54 46.209 52.209 48 50 48 L14 48 C11.791 48 10 46.209 10 44 Z" fill="#076de2"/>
                  <path d="M14 36 L50 36 L50 28 C50 24 46 20 40 20 L24 20 C18 20 14 24 14 28 Z" fill="#076de2"/>
                  <circle cx="20" cy="50" r="3.5" fill="#09ebb2"/>
                  <circle cx="44" cy="50" r="3.5" fill="#09ebb2"/>
                  <circle cx="20" cy="50" r="2" fill="#fff"/>
                  <circle cx="44" cy="50" r="2" fill="#fff"/>
                  <path d="M18 30 L26 30 L26 26 L18 26 Z" fill="#fff" opacity="0.15"/>
                  <path d="M38 30 L46 30 L46 26 L38 26 Z" fill="#fff" opacity="0.15"/>
                </g>
              </svg>
            `;
            return el;
        }

        function atualizarUserMarker(lat, lon) {
            if (!userMarker) {
                const el = criarCarMarker();
                userMarker = new maplibregl.Marker({ element: el, anchor: "center" })
                    .setLngLat([lon, lat])
                    .addTo(map);
            } else {
                userMarker.setLngLat([lon, lat]);
            }
        }

        function rotacionarCarroPara(bearing) {
            if (!userMarker) return;
            const el = userMarker.getElement();
            // rotaciona o SVG para apontar na direção do movimento
            // subtrai 90 se o desenho estiver apontando para a direita; ajuste conforme necessário
            el.style.transform = `rotate(${bearing}deg)`;
        }

        // ============================
        // ATUALIZAÇÃO DE LOCALIZAÇÃO
        // ============================
        function atualizarLocalizacao(pos) {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            ultimaLatitude = lat;
            ultimaLongitude = lon;
            statusDiv.textContent = "Localização atualizada";

            // atualiza marker do carro (DOM)
            atualizarUserMarker(lat, lon);

            // calcula e aplica rotação do ícone do carro
            if (ultimaPosParaRotacao) {
                const b = calcularBearing(ultimaPosParaRotacao.lat, ultimaPosParaRotacao.lon, lat, lon);
                rotacionarCarroPara(b);
            }
            ultimaPosParaRotacao = { lat, lon };

            // orienta mapa pela rota (nativo)
            orientarPelaRota(lat, lon);

            if (primeiraAtualizacao) {
                map.jumpTo({ center: [lon, lat], zoom: 17 });
                primeiraAtualizacao = false;
                calcularRota();
            } else {
                map.panTo([lon, lat], { duration: 300 });
                if (estaForaDaRota(lat, lon)) {
                    calcularRota();
                }
            }
        }

        function tratarErroGeolocalizacao(err) {
            statusDiv.textContent = "Erro ao obter localização.";
            console.error(err);
        }

        function iniciarWatch() {
            if (!("geolocation" in navigator)) {
                statusDiv.textContent = "Geolocalização não suportada.";
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    atualizarLocalizacao(pos);
                    if (watchId === null) {
                        watchId = navigator.geolocation.watchPosition(
                            atualizarLocalizacao,
                            tratarErroGeolocalizacao,
                            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
                        );
                    }
                },
                tratarErroGeolocalizacao,
                { enableHighAccuracy: true, maximumAge: 0, timeout: 7000 }
            );
        }

        iniciarWatch();

        // limpa sugestões ao clicar fora
        document.addEventListener("click", (e) => {
            if (!inputDestino.contains(e.target) && !lista.contains(e.target)) {
                lista.innerHTML = "";
            }
        });
    }
});
