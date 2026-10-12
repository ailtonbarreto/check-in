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

        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10`;
        try {
            const resp = await fetch(url);
            const dados = await resp.json();
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
                    id: f.properties.osm_id || f.properties.osm_key || `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`
                };
            });

            const seen = new Set();
            const unique = [];
            for (const it of items) {
                const key = it.display_name.trim().toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(it);
                }
            }
            return unique.slice(0, 5); // mantém o limit desejado
        } catch (e) {
            console.error("Erro ao buscar sugestões:", e);
            return [];
        }
    }


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
    // MAPA (MapLibre GL JS)
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
        // Autocomplete debounce
        // ============================
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
                    item.addEventListener("click", async () => {
                        inputDestino.value = s.display_name;
                        lista.innerHTML = "";
                        destinoFixo = { lat: parseFloat(s.lat), lon: parseFloat(s.lon) };
                        await calcularRota();
                        orientarPelaRota(ultimaLatitude, ultimaLongitude);
                    });
                    lista.appendChild(item);
                });
            }, 220);
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

        // user marker DOM (carro)
        let userMarker = null;
        let ultimaPosParaRotacao = null;

        // configurações do ícone do carro
        const ICON_URL = "car.png"; // troque pela sua URL ou DataURL
        const ICON_SIZE = 96; // ajuste aqui o tamanho em pixels

        // adiciona fonte/layer para rota
        map.on("load", () => {
            map.addSource("rota", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
            map.addLayer({
                id: "rota-line",
                type: "line",
                source: "rota",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: { "line-color": "#19AF8C", "line-width": 5 }
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
        // ORIENTAR MAPA PELA ROTA (sempre)
        // ============================
        function orientarPelaRota(lat, lon) {
            if (rotaLatLngs.length < 2) return;
            const idx = pontoMaisProximo(lat, lon);
            const proxIdx = Math.min(idx + 1, rotaLatLngs.length - 1);
            const prox = rotaLatLngs[proxIdx];
            const bearing = calcularBearing(lat, lon, prox[0], prox[1]);
            // usamos rotação suave com easing customizado abaixo
            rotateMapSmooth(bearing);
        }

        // ============================
        // GEOCODIFICACAO (PHOTON)
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
        // DISTÂNCIA E SAIDA DA ROTA
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

            // aguarda rota calculada e então orienta o mapa para frente da rota
            await calcularRota();
            if (ultimaLatitude !== null && ultimaLongitude !== null) {
                orientarPelaRota(ultimaLatitude, ultimaLongitude);
            }
        });

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

        console.log("rotaLatLngs length:", rotaLatLngs.length);
        console.log("primeiros pontos rota:", rotaLatLngs.slice(0, 3));
        console.log("pos atual:", ultimaLatitude, ultimaLongitude);

        // ============================
        // Cria marcador do carro
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
        function easeOutCubic(t) {
            return 1 - Math.pow(1 - t, 3);
        }
        function easeInOutQuad(t) {
            return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        }

        // ============================
        // ROTACAO SUAVE DO CARRO (requestAnimationFrame)
        // ============================
        let ultimoBearing = 0;
        let carroAnimFrame = null;

        function rotacionarCarroGradualmente(novoBearing, duracao = 1000, easing = easeOutCubic) {
            if (!userMarker) {
                ultimoBearing = novoBearing;
                return;
            }
            cancelAnimationFrame(carroAnimFrame);

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
        // ROTACAO SUAVE DO MAPA (usa map.rotateTo com easing e fallback)
        // ============================
        let mapaAnimTimeout = null;
        function rotateMapSmooth(targetBearing) {
            // calcula diferença para decidir duração/easing
            const current = (map.getBearing && typeof map.getBearing === "function") ? map.getBearing() : 0;
            let diff = Math.abs(((targetBearing - current + 540) % 360) - 180); // menor ângulo
            // duração baseada na intensidade da curva
            let duracao;
            let easingFunc;
            if (diff < 15) {
                duracao = 400;
                easingFunc = t => t; // quase linear para pequenas correções
            } else if (diff < 60) {
                duracao = 900;
                easingFunc = easeOutCubic;
            } else {
                duracao = 1200;
                easingFunc = t => easeInOutQuad(t);
            }

            // MapLibre aceita easing: function(t) { ... }
            try {
                map.rotateTo(targetBearing, { duration: duracao, easing: easingFunc });
            } catch (e) {
                // fallback manual se rotateTo não suportar easing function
                if (mapaAnimTimeout) clearTimeout(mapaAnimTimeout);
                map.rotateTo(targetBearing, { duration: 0 });
            }
        }

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
        // ATUALIZACAO DE LOCALIZACAO
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

                // gira o mapa suavemente e o carro com mesma duração/easing adaptativa
                rotateMapSmooth(bearing);

                // escolhe duração do carro baseada na intensidade da curva (mais natural)
                const currentMapBearing = (map.getBearing && typeof map.getBearing === "function") ? map.getBearing() : 0;
                let diff = Math.abs(((bearing - currentMapBearing + 540) % 360) - 180);
                let duracaoCarro = diff < 15 ? 400 : diff < 60 ? 900 : 1200;
                // carro usa easing ligeiramente mais responsiva
                rotacionarCarroGradualmente(bearing, duracaoCarro, t => easeOutCubic(t));
            }

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

        // mantém orientação alinhada periodicamente (caso necessário)
        setInterval(() => {
            if (ultimaLatitude !== null && ultimaLongitude !== null) {
                orientarPelaRota(ultimaLatitude, ultimaLongitude);
            }
        }, 500);

        iniciarWatch();

        document.addEventListener("click", (e) => {
            if (!inputDestino.contains(e.target) && !lista.contains(e.target)) {
                lista.innerHTML = "";
            }
        });

        window.addEventListener("beforeunload", function () {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            pararEnvioPeriodico();
            if (carroAnimFrame) cancelAnimationFrame(carroAnimFrame);
        });
    }
});
