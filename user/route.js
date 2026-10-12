document.addEventListener("DOMContentLoaded", function () {

    // ============================
    // Elementos DOM
    // ============================
    const statusDiv = document.getElementById("status");
    const inputDestino = document.getElementById("destino-input");
    const lista = document.getElementById("autocomplete-list");
    const btnIr = document.getElementById("btn-ir");

    // ============================
    // UTIL: debounce
    // ============================
    function debounce(fn, wait) {
        let t = null;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    }

    // ============================
    // AUTOCOMPLETE (Photon) com dedupe
    // ============================
    async function buscarSugestoes(query) {
        if (!query || query.length < 3) return [];

        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10`;

        try {
            const resp = await fetch(url);
            const dados = await resp.json();
            if (!dados.features) return [];

            const items = dados.features.map(f => {
                const display_name = [
                    f.properties.name,
                    f.properties.street,
                    f.properties.city,
                    f.properties.state,
                    f.properties.country
                ].filter(Boolean).join(", ");
                return {
                    display_name,
                    lat: f.geometry.coordinates[1],
                    lon: f.geometry.coordinates[0],
                    osm_id: f.properties.osm_id || null
                };
            });

            // dedupe por display_name (case-insensitive) e por coordenadas arredondadas
            const seen = new Set();
            const unique = [];
            for (const it of items) {
                const coordKey = `${it.lat.toFixed(5)},${it.lon.toFixed(5)}`;
                const key = (it.display_name || "").trim().toLowerCase() + "|" + coordKey;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(it);
                }
            }
            return unique.slice(0, 5);
        } catch (e) {
            console.error("Erro ao buscar sugestões:", e);
            return [];
        }
    }

    // autocomplete UI
    const handleInput = debounce(async () => {
        const texto = inputDestino.value.trim();
        lista.innerHTML = "";
        if (texto.length < 3) return;
        const sugestoes = await buscarSugestoes(texto);
        sugestoes.forEach(s => {
            const item = document.createElement("div");
            item.className = "autocomplete-item";
            item.textContent = s.display_name;
            item.addEventListener("click", async () => {
                inputDestino.value = s.display_name;
                lista.innerHTML = "";
                destinoFixo = { lat: parseFloat(s.lat), lon: parseFloat(s.lon) };
                if (!isUserInteracting) {
                    await calcularRota();
                    if (ultimaLatitude !== null && ultimaLongitude !== null) {
                        orientarPelaRota(ultimaLatitude, ultimaLongitude);
                    }
                }
            });
            // proteção extra contra duplicatas na UI
            if (!Array.from(lista.children).some(c => c.textContent === s.display_name)) {
                lista.appendChild(item);
            }
        });
    }, 220);

    inputDestino.addEventListener("input", handleInput);

    // fecha lista ao clicar fora
    document.addEventListener("click", (e) => {
        if (!inputDestino.contains(e.target) && !lista.contains(e.target)) {
            lista.innerHTML = "";
        }
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
    // INIT MAP + LÓGICA PRINCIPAL
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

        // ============================
        // Estado
        // ============================
        let primeiraAtualizacao = true;
        let ultimaLatitude = null;
        let ultimaLongitude = null;
        let watchId = null;
        let sendIntervalId = null;

        let destinoFixo = null;
        let destinoMarker = null;
        let rotaGeoJSON = null;
        let rotaLatLngs = [];

        // user marker (carro)
        let userMarker = null;

        // ícone carro
        const ICON_URL = "car.png";
        const ICON_SIZE = 96;

        // rotação carro
        let ultimoBearing = 0;
        let carroAnimFrame = null;

        // setas de orientação (dados e HTML pool)
        let turnPoints = []; // detectados na rota
        let htmlTurnPoints = []; // pool para overlay HTML
        let currentHtmlTurnIndex = null;

        // controle de interação do usuário (grab/drag)
        let isUserInteracting = false;
        let resumeTimeout = null;
        let wasSending = false;

        // ============================
        // Adiciona source/layer rota ao carregar mapa
        // ============================
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
        // DISTÂNCIA (Haversine)
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

        // ============================
        // PONTO MAIS PRÓXIMO NA ROTA
        // ============================
        function pontoMaisProximo(lat, lon) {
            if (!rotaLatLngs || rotaLatLngs.length === 0) return 0;
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
        // ORIENTAR MAPA PELA ROTA (usa rotateMapSmooth)
        // ============================
        function orientarPelaRota(lat, lon) {
            if (rotaLatLngs.length < 2) return;
            const idx = pontoMaisProximo(lat, lon);
            const proxIdx = Math.min(idx + 1, rotaLatLngs.length - 1);
            const prox = rotaLatLngs[proxIdx];
            const bearing = calcularBearing(lat, lon, prox[0], prox[1]);
            rotateMapSmooth(bearing);
        }

        // ============================
        // CRIAR E ATUALIZAR MARKER DO CARRO
        // ============================
        function criarCarMarkerComImagem(srcUrl, sizePx = ICON_SIZE) {
            const el = document.createElement("div");
            el.className = "car-marker";
            el.style.width = sizePx + "px";
            el.style.height = sizePx + "px";
            el.style.display = "flex";
            el.style.alignItems = "center";
            el.style.justifyContent = "center";
            el.style.pointerEvents = "none";
            el.style.transformOrigin = "center center";
            el.style.willChange = "transform";

            const img = document.createElement("img");
            img.src = srcUrl;
            img.style.width = sizePx + "px";
            img.style.height = sizePx + "px";
            img.style.objectFit = "contain";
            img.alt = "carro";
            img.draggable = false;

            el.appendChild(img);
            return el;
        }

        function atualizarUserMarker(lat, lon) {
            if (!userMarker) {
                const el = criarCarMarkerComImagem(ICON_URL, ICON_SIZE);
                userMarker = new maplibregl.Marker({ element: el, anchor: "center" })
                    .setLngLat([lon, lat])
                    .addTo(map);
            } else {
                userMarker.setLngLat([lon, lat]);
            }
        }

        // ============================
        // EASING HELPERS
        // ============================
        function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
        function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

        // ============================
        // ROTACAO SUAVE DO CARRO (requestAnimationFrame)
        // ============================
        function rotacionarCarroGradualmente(novoBearing, duracao = 1000, easing = easeOutCubic) {
            if (!userMarker) {
                ultimoBearing = novoBearing;
                return;
            }
            if (carroAnimFrame) cancelAnimationFrame(carroAnimFrame);

            // normaliza diferença para o menor caminho
            let diff = novoBearing - ultimoBearing;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;

            const start = performance.now();
            const inicio = ultimoBearing;

            function step(now) {
                const elapsed = now - start;
                const t = Math.min(1, elapsed / duracao);
                const eased = easing(t);
                const current = inicio + diff * eased;
                const el = userMarker.getElement();
                el.style.transform = `rotate(${current}deg)`;
                if (t < 1) {
                    carroAnimFrame = requestAnimationFrame(step);
                } else {
                    ultimoBearing = (inicio + diff + 360) % 360;
                }
            }
            carroAnimFrame = requestAnimationFrame(step);
        }

        // ============================
        // ROTACAO SUAVE DO MAPA (com adaptação por intensidade)
        // ============================
        function rotateMapSmooth(targetBearing) {
            const current = (map.getBearing && typeof map.getBearing === "function") ? map.getBearing() : 0;
            let diff = Math.abs(((targetBearing - current + 540) % 360) - 180);
            let duracao;
            let easingFunc;
            if (diff < 15) {
                duracao = 400;
                easingFunc = t => t;
            } else if (diff < 60) {
                duracao = 900;
                easingFunc = easeOutCubic;
            } else {
                duracao = 1200;
                easingFunc = easeInOutQuad;
            }
            try {
                map.rotateTo(targetBearing, { duration: duracao, easing: easingFunc });
            } catch (e) {
                // fallback: rotação instantânea
                map.rotateTo(targetBearing, { duration: 0 });
            }
        }

        // ============================
        // OVERLAY HTML DE SETAS (pool)
        // ============================
        function criarOverlaySetasHTML() {
            if (document.getElementById("turn-overlay")) return;
            const container = document.createElement("div");
            container.id = "turn-overlay";
            container.style.position = "fixed";
            container.style.pointerEvents = "none";
            container.innerHTML = `
              <div id="turn-arrow" class="hidden" style="display:flex;align-items:center;gap:12px;background:rgba(0,0,0,0.75);color:#fff;padding:10px 14px;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,0.35);transform-origin:left center;transition:transform 300ms ease,opacity 300ms ease;opacity:0;transform:translateY(8px) scale(0.98);">
                <div class="arrow-icon" style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#fff,#ddd);border-radius:50%;box-shadow:0 4px 10px rgba(0,0,0,0.25);transform-origin:50% 50%;"></div>
                <div class="turn-info" style="display:flex;flex-direction:column;line-height:1;">
                  <div class="turn-action" style="font-weight:700;font-size:14px;"></div>
                  <div class="turn-distance" style="font-size:13px;opacity:0.9;"></div>
                  <div class="turn-street" style="font-size:12px;opacity:0.8;margin-top:4px;"></div>
                </div>
              </div>
            `;
            document.body.appendChild(container);
        }

        function popularOverlaySetasHTML() {
            htmlTurnPoints = turnPoints.map(tp => ({
                idx: tp.idx,
                lat: tp.lat,
                lon: tp.lon,
                bearing: tp.bearing,
                type: tp.type,
                angle: tp.angle,
                street: tp.street || ""
            }));
            currentHtmlTurnIndex = null;
            mostrarProximaSetaHTML();
        }

        function mostrarProximaSetaHTML() {
            const overlay = document.getElementById("turn-arrow");
            if (!overlay) return;
            if (!htmlTurnPoints || htmlTurnPoints.length === 0) {
                esconderOverlaySeta();
                return;
            }
            const idxAtual = pontoMaisProximo(ultimaLatitude, ultimaLongitude);
            let prox = null;
            for (let i = 0; i < htmlTurnPoints.length; i++) {
                if (htmlTurnPoints[i].idx > idxAtual) { prox = i; break; }
            }
            if (prox === null) {
                esconderOverlaySeta();
                return;
            }
            currentHtmlTurnIndex = prox;
            const tp = htmlTurnPoints[prox];

            overlay.classList.remove("left","right","straight","hidden");
            overlay.classList.add(tp.type || "straight");

            const icon = overlay.querySelector(".arrow-icon");
            icon.style.transform = `rotate(${tp.bearing}deg)`;
            if (!icon.querySelector("svg")) {
                icon.innerHTML = `<svg viewBox="0 0 24 24" width="36" height="36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12h12" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 6l6 6-6 6" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            }
            overlay.querySelector(".turn-action").textContent = tp.type === "left" ? "Vire à esquerda" : tp.type === "right" ? "Vire à direita" : "Siga em frente";
            const dist = Math.round(distanciaEmMetros(ultimaLatitude, ultimaLongitude, tp.lat, tp.lon));
            overlay.querySelector(".turn-distance").textContent = `Em ${dist} m`;
            overlay.querySelector(".turn-street").textContent = tp.street || "";

            overlay.style.opacity = "1";
            overlay.style.transform = "translateY(0) scale(1)";
            overlay.classList.remove("hidden");
        }

        function esconderOverlaySeta() {
            const overlay = document.getElementById("turn-arrow");
            if (!overlay) return;
            overlay.style.opacity = "0";
            overlay.style.transform = "translateY(8px) scale(0.98)";
            overlay.classList.add("hidden");
            currentHtmlTurnIndex = null;
        }

        function checarPassagemSetaHTML() {
            if (currentHtmlTurnIndex === null) return;
            const tp = htmlTurnPoints[currentHtmlTurnIndex];
            if (!tp) return;
            const dist = distanciaEmMetros(ultimaLatitude, ultimaLongitude, tp.lat, tp.lon);
            if (dist < 12) {
                htmlTurnPoints.splice(currentHtmlTurnIndex, 1);
                mostrarProximaSetaHTML();
            } else {
                const overlay = document.getElementById("turn-arrow");
                if (overlay && !overlay.classList.contains("hidden")) {
                    overlay.querySelector(".turn-distance").textContent = `Em ${Math.round(dist)} m`;
                }
            }
        }

        // ============================
        // DETECÇÃO DE PONTOS DE VIRADA (após rota calculada)
        // ============================
        function detectarPontosDeVirada() {
            turnPoints = [];
            if (!rotaLatLngs || rotaLatLngs.length < 3) return;
            const ANGLE_THRESHOLD = 25;
            const MIN_SEGMENT_DISTANCE = 5;
            for (let i = 1; i < rotaLatLngs.length - 1; i++) {
                const prev = rotaLatLngs[i - 1];
                const cur = rotaLatLngs[i];
                const next = rotaLatLngs[i + 1];
                const b1 = calcularBearing(prev[0], prev[1], cur[0], cur[1]);
                const b2 = calcularBearing(cur[0], cur[1], next[0], next[1]);
                let diff = b2 - b1;
                diff = ((diff + 540) % 360) - 180;
                const absDiff = Math.abs(diff);
                const d1 = distanciaEmMetros(prev[0], prev[1], cur[0], cur[1]);
                const d2 = distanciaEmMetros(cur[0], cur[1], next[0], next[1]);
                if (absDiff >= ANGLE_THRESHOLD && d1 > MIN_SEGMENT_DISTANCE && d2 > MIN_SEGMENT_DISTANCE) {
                    const type = diff > 0 ? "right" : "left";
                    turnPoints.push({
                        idx: i,
                        lat: cur[0],
                        lon: cur[1],
                        bearing: b2,
                        type,
                        angle: absDiff,
                        street: "" // opcional: preencher via reverse-geocode se desejar
                    });
                }
            }
        }

        // ============================
        // PAUSA E RETOMA DE TAREFAS PESADAS DURANTE INTERAÇÃO DO USUÁRIO
        // ============================
        function pauseHeavyWork() {
            if (isUserInteracting) return;
            isUserInteracting = true;
            if (sendIntervalId !== null) {
                wasSending = true;
                clearInterval(sendIntervalId);
                sendIntervalId = null;
            } else {
                wasSending = false;
            }
            if (carroAnimFrame) {
                cancelAnimationFrame(carroAnimFrame);
                carroAnimFrame = null;
            }
            statusDiv.textContent = "Interação do usuário — tarefas pausadas";
        }

        function resumeHeavyWorkDebounced(delay = 300) {
            if (resumeTimeout) clearTimeout(resumeTimeout);
            resumeTimeout = setTimeout(() => {
                resumeHeavyWork();
                resumeTimeout = null;
            }, delay);
        }

        function resumeHeavyWork() {
            if (!isUserInteracting) return;
            isUserInteracting = false;
            if (wasSending && sendIntervalId === null) {
                enviarPosicao();
                sendIntervalId = setInterval(enviarPosicao, 5000);
            }
            if (ultimaLatitude !== null && ultimaLongitude !== null && destinoFixo) {
                calcularRota();
            }
            statusDiv.textContent = "Pronto";
        }

        // MapLibre interaction events
        map.on("dragstart", () => pauseHeavyWork());
        map.on("dragend", () => resumeHeavyWorkDebounced(300));
        map.on("movestart", () => pauseHeavyWork());
        map.on("moveend", () => resumeHeavyWorkDebounced(300));

        // canvas pointer fallback
        const canvas = map.getCanvas();
        canvas.addEventListener("pointerdown", () => pauseHeavyWork());
        canvas.addEventListener("pointerup", () => resumeHeavyWorkDebounced(300));
        canvas.addEventListener("pointercancel", () => resumeHeavyWorkDebounced(300));

        // ============================
        // DATA/HORA BRASIL (para envio)
        // ============================
        function dataHoraBrasil() {
            const agora = new Date();
            const offsetMs = -3 * 60 * 60 * 1000;
            const brasil = new Date(agora.getTime() + offsetMs);
            return brasil.toISOString().slice(0, 19).replace("T", " ");
        }

        // ============================
        // ENVIO PARA API (a cada 5s)
        // ============================
        async function enviarPosicao() {
            if (ultimaLatitude === null || ultimaLongitude === null) return;
            statusDiv.textContent = "Enviando...";
            const payload = {
                pessoa: localStorage.getItem("nome") || "Desconhecido",
                lat: ultimaLatitude,
                lon: ultimaLongitude,
                data: dataHoraBrasil()
            };
            try {
                const resp = await fetch("https://api-checkin-7zte.onrender.com/input", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                if (!resp.ok) throw new Error("Resposta não OK: " + resp.status);
                statusDiv.textContent = "Localização enviada";
            } catch (err) {
                console.error("Erro ao enviar posição:", err);
                statusDiv.textContent = "Erro ao enviar";
            }
        }

        function iniciarEnvioPeriodico() {
            if (sendIntervalId !== null) return;
            enviarPosicao();
            sendIntervalId = setInterval(enviarPosicao, 5000);
        }

        function pararEnvioPeriodico() {
            if (sendIntervalId !== null) {
                clearInterval(sendIntervalId);
                sendIntervalId = null;
            }
        }

        // ============================
        // CALCULAR ROTA (OSRM) - substitui a sua função
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
                statusDiv.textContent = "Calculando rota...";
                const response = await fetch(url);
                const data = await response.json();

                if (!data.routes || !data.routes[0] || !data.routes[0].geometry) {
                    throw new Error("Resposta de rota inválida");
                }

                const coords = data.routes[0].geometry.coordinates; // [lon, lat]
                rotaLatLngs = coords.map(c => [c[1], c[0]]);

                // detectar pontos de virada e popular overlay HTML
                detectarPontosDeVirada();
                popularOverlaySetasHTML();

                rotaGeoJSON = {
                    type: "FeatureCollection",
                    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords } }]
                };

                if (map.getSource("rota")) {
                    map.getSource("rota").setData(rotaGeoJSON);
                } else {
                    map.addSource("rota", { type: "geojson", data: rotaGeoJSON });
                    map.addLayer({
                        id: "rota-line",
                        type: "line",
                        source: "rota",
                        layout: { "line-join": "round", "line-cap": "round" },
                        paint: { "line-color": "#1976d2", "line-width": 5 }
                    });
                }

                map.easeTo({ center: [ultimaLongitude, ultimaLatitude], zoom: 17, duration: 300 });

                statusDiv.textContent = "Rota calculada";

                await new Promise(r => setTimeout(r, 80));

                if (ultimaLatitude !== null && ultimaLongitude !== null) {
                    orientarPelaRota(ultimaLatitude, ultimaLongitude);
                }

            } catch (err) {
                console.error("Erro ao calcular rota:", err);
                statusDiv.textContent = "Erro ao calcular rota";
            }
        }

        // ============================
        // ATUALIZAÇÃO DE LOCALIZAÇÃO (watchPosition)
        // ============================
        function atualizarLocalizacao(pos) {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            ultimaLatitude = lat;
            ultimaLongitude = lon;
            statusDiv.textContent = "Localização atualizada";

            atualizarUserMarker(lat, lon);

            if (rotaLatLngs.length > 1) {
                const idx = pontoMaisProximo(lat, lon);
                const proxIdx = Math.min(idx + 1, rotaLatLngs.length - 1);
                const prox = rotaLatLngs[proxIdx];
                const bearing = calcularBearing(lat, lon, prox[0], prox[1]);

                if (!isUserInteracting) {
                    rotateMapSmooth(bearing);
                    const currentMapBearing = (map.getBearing && typeof map.getBearing === "function") ? map.getBearing() : 0;
                    let diff = Math.abs(((bearing - currentMapBearing + 540) % 360) - 180);
                    let duracaoCarro = diff < 15 ? 400 : diff < 60 ? 900 : 1200;
                    rotacionarCarroGradualmente(bearing, duracaoCarro, t => easeOutCubic(t));
                }
            }

            if (primeiraAtualizacao) {
                map.jumpTo({ center: [lon, lat], zoom: 17 });
                primeiraAtualizacao = false;
                if (!isUserInteracting) calcularRota();
            } else {
                if (!isUserInteracting) {
                    map.panTo([lon, lat], { duration: 300 });
                    if (estaForaDaRota(lat, lon)) {
                        calcularRota();
                    }
                }
            }

            // atualiza overlay de setas
            if (!isUserInteracting) {
                mostrarProximaSetaHTML();
                checarPassagemSetaHTML();
            }

            iniciarEnvioPeriodico();
        }

        function tratarErroGeolocalizacao(err) {
            console.error("Erro geolocalização:", err.code, err.message);
            if (err.code === 1) statusDiv.textContent = "Permissão negada.";
            else if (err.code === 2) statusDiv.textContent = "Posição indisponível.";
            else if (err.code === 3) statusDiv.textContent = "Tempo esgotado.";
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
                { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
            );
        }

        // ============================
        // ESTA FORA DA ROTA (verifica distância mínima)
        // ============================
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
        // BOTÃO "IR" (geocodifica e calcula rota)
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

            if (!isUserInteracting) {
                await calcularRota();
                if (ultimaLatitude !== null && ultimaLongitude !== null) {
                    orientarPelaRota(ultimaLatitude, ultimaLongitude);
                }
            }
        });

        // ============================
        // GEOCODIFICAÇÃO (PHOTON) - para botão IR
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
        // Inicializações finais
        // ============================
        criarOverlaySetasHTML();
        iniciarWatch();

        // mantém orientação alinhada periodicamente (caso necessário)
        setInterval(() => {
            if (ultimaLatitude !== null && ultimaLongitude !== null) {
                orientarPelaRota(ultimaLatitude, ultimaLongitude);
            }
        }, 500);

        // cleanup on unload
        window.addEventListener("beforeunload", function () {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            pararEnvioPeriodico();
            if (carroAnimFrame) cancelAnimationFrame(carroAnimFrame);
        });

        // expõe algumas funções para debug no console (opcional)
        window.__debugMap = {
            map, calcularRota, detectarPontosDeVirada, rotaLatLngs
        };
    }
});
