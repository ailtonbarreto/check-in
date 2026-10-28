document.addEventListener("DOMContentLoaded", function () {

    const statusDiv = document.getElementById("status");
    const inputDestino = document.getElementById("destino-input");
    const lista = document.getElementById("autocomplete-list");
    const btnIr = document.getElementById("btn-ir");
    const startRouteButton = document.getElementById("start-route");
    const navigationToggle = document.getElementById("navigation-toggle");
    const navigationToggleLabel = document.getElementById("navigation-toggle-label");
    const simulateRouteToggle = document.getElementById("simulate-route-toggle");
    const routeProgress = document.getElementById("route-progress");
    const routeProgressFill = document.getElementById("route-progress-fill");
    const routeProgressLabel = document.getElementById("route-progress-label");
    const rideCard = document.getElementById("ride-card");
    const ridePrice = document.getElementById("ride-heading");
    const rideRating = document.getElementById("ride-rating");
    const ridePickupDistance = document.getElementById("ride-pickup-distance");
    const rideOrigin = document.getElementById("ride-origin-detail");
    const rideDuration = document.getElementById("ride-duration");
    const rideDistance = document.getElementById("ride-distance");
    const rideDestination = document.getElementById("ride-destination");
    const rideFeedback = document.getElementById("ride-feedback");
    const acceptRideButton = document.getElementById("accept-ride");
    const declineRideButton = document.getElementById("decline-ride");
    const dismissedMessage = document.getElementById("dismissed-message");
    const apiBaseUrl = "https://api-checkin-s376.onrender.com";
    const driverId = localStorage.getItem("id_motorista");
    const rideSocketUrl = `${apiBaseUrl.replace(/^http/, "ws")}/ws/driver?id_motorista=${encodeURIComponent(driverId || "")}`;
    let rideSocket = null;
    let rideReconnectTimeout = null;
    let rideHeartbeatInterval = null;
    let currentRideId = null;
    let shuttingDown = false;
    let decidingRide = false;
    let selecionarDestino = null;
    let iniciarOrientacaoBussola = null;

    function obterCampo(source, keys) {
        for (const key of keys) {
            if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
                return source[key];
            }
        }
        return null;
    }

    function textoDoLocal(value) {
        if (typeof value === "string" || typeof value === "number") return String(value);
        if (!value || typeof value !== "object") return "";
        return obterCampo(value, ["address", "endereco", "display_name", "name", "nome", "label"]) || "";
    }

    function formatarPreco(value) {
        if (typeof value === "number" || (typeof value === "string" && /^\d+([.,]\d{1,2})?$/.test(value.trim()))) {
            const numericValue = typeof value === "number" ? value : Number(value.replace(",", "."));
            return numericValue.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL"
            });
        }
        return textoDoLocal(value) || "—";
    }

    function formatarNumero(value, suffix) {
        if (typeof value === "number") return `${value.toLocaleString("pt-BR")}${suffix}`;
        if (typeof value === "string" && /^\d+([.,]\d+)?$/.test(value.trim())) {
            return `${value.trim().replace(".", ",")}${suffix}`;
        }
        return textoDoLocal(value) || "—";
    }

    function formatarAvaliacao(value) {
        if (typeof value === "number" || (typeof value === "string" && /^\d+([.,]\d+)?$/.test(value.trim()))) {
            const numericValue = typeof value === "number" ? value : Number(value.replace(",", "."));
            return numericValue.toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }
        return textoDoLocal(value) || "—";
    }

    function normalizarCorrida(payload) {
        let data = payload;
        if (data && !Array.isArray(data) && data.data !== undefined) data = data.data;
        if (data && !Array.isArray(data) && data.ride !== undefined) data = data.ride;
        if (Array.isArray(data)) data = data[0];
        if (!data || typeof data !== "object") {
            throw new Error("A API não retornou uma oferta de corrida válida.");
        }

        const originValue = obterCampo(data, [
            "origin", "origem", "pickup", "embarque", "pickup_address", "endereco_origem"
        ]);
        const destinationValue = obterCampo(data, [
            "destination", "destino", "dropoff", "desembarque", "dropoff_address", "endereco_destino"
        ]);

        return {
            price: formatarPreco(obterCampo(data, ["price", "preco", "fare", "valor"])),
            rating: formatarAvaliacao(obterCampo(data, ["rating", "avaliacao", "nota"])),
            pickupDistance: formatarNumero(obterCampo(data, [
                "pickup_distance", "pickupDistance", "distancia_origem", "pickup_eta", "eta"
            ]), " de distância"),
            origin: textoDoLocal(originValue) || "Origem não informada",
            duration: formatarNumero(obterCampo(data, [
                "duration", "duracao", "trip_duration", "tempo_viagem"
            ]), " min"),
            distance: formatarNumero(obterCampo(data, [
                "distance", "distancia", "trip_distance", "distancia_viagem"
            ]), " km"),
            destination: textoDoLocal(destinationValue) || "Destino não informado"
        };
    }

    function mostrarOfertaCorrida(payload) {
        const ride = normalizarCorrida(payload);
        const rideData = payload && payload.ride ? payload.ride : payload;
        currentRideId = rideData.id_rota ?? rideData.id ?? null;

        ridePrice.textContent = ride.price;
        rideRating.textContent = ride.rating;
        ridePickupDistance.textContent = ride.pickupDistance;
        rideOrigin.textContent = ride.origin;
        rideDuration.textContent = ride.duration;
        rideDistance.textContent = ride.distance;
        rideDestination.textContent = ride.destination;
        rideFeedback.textContent = "";
        rideFeedback.classList.remove("is-error");
        rideCard.hidden = false;
        dismissedMessage.hidden = true;
        acceptRideButton.disabled = currentRideId === null;
        declineRideButton.disabled = currentRideId === null;
        acceptRideButton.textContent = "Aceitar";
        if (currentRideId === null) {
            rideFeedback.textContent = "A oferta recebida não contém o ID da rota.";
            rideFeedback.classList.add("is-error");
        }
    }

    async function decidirCorrida(decisao) {
        if (decidingRide || currentRideId === null) return;
        if (!driverId) {
            rideFeedback.textContent = "ID do motorista ausente. Saia e entre novamente.";
            rideFeedback.classList.add("is-error");
            return;
        }

        decidingRide = true;
        acceptRideButton.disabled = true;
        declineRideButton.disabled = true;
        rideFeedback.classList.remove("is-error");
        rideFeedback.textContent = decisao === "aceitar" ? "Confirmando corrida..." : "Enviando recusa...";
        try {
            const response = await fetch(`${apiBaseUrl}/oferta_corrida/${encodeURIComponent(currentRideId)}/decisao`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_motorista: Number(driverId), decisao })
            });
            const result = await response.json();
            if (!response.ok || result.success !== true) {
                throw new Error(result.message || `A API respondeu com status ${response.status}.`);
            }

            if (decisao === "aceitar") {
                rideFeedback.textContent = "Corrida aceita. O passageiro foi avisado.";
                acceptRideButton.textContent = "Corrida aceita";
            } else {
                rideFeedback.textContent = "Oferta recusada. O passageiro poderá escolher outro motorista.";
                rideCard.hidden = true;
                dismissedMessage.hidden = false;
            }
            currentRideId = null;
        } catch (error) {
            console.error(`Erro ao ${decisao} corrida:`, error);
            rideFeedback.textContent = error.message || "Não foi possível registrar sua decisão.";
            rideFeedback.classList.add("is-error");
            acceptRideButton.disabled = false;
            declineRideButton.disabled = false;
        } finally {
            decidingRide = false;
        }
    }

    function conectarOfertasCorrida() {
        if (shuttingDown) return;
        if (!driverId) {
            rideFeedback.textContent = "Entre novamente para conectar sua conta de motorista.";
            rideFeedback.classList.add("is-error");
            return;
        }
        if (rideSocket && rideSocket.readyState <= WebSocket.OPEN) return;

        const socket = new WebSocket(rideSocketUrl);
        rideSocket = socket;

        socket.addEventListener("open", () => {
            rideHeartbeatInterval = window.setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) socket.send("ping");
            }, 25000);
        });

        socket.addEventListener("message", (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.event === "new_ride" && message.ride) {
                    mostrarOfertaCorrida(message.ride);
                }
            } catch (error) {
                console.error("Erro ao processar oferta recebida pelo WebSocket:", error);
            }
        });

        socket.addEventListener("error", (error) => {
            console.error("Erro na conexão de ofertas de corrida:", error);
            socket.close();
        });

        socket.addEventListener("close", () => {
            window.clearInterval(rideHeartbeatInterval);
            if (rideSocket === socket && !shuttingDown) {
                rideSocket = null;
                rideReconnectTimeout = window.setTimeout(conectarOfertasCorrida, 5000);
            }
        });
    }

    document.getElementById("dismiss-ride").addEventListener("click", () => {
        rideCard.hidden = true;
        dismissedMessage.hidden = true;
    });

    document.getElementById("show-ride").addEventListener("click", () => {
        dismissedMessage.hidden = true;
        rideCard.hidden = false;
    });

    acceptRideButton.addEventListener("click", () => decidirCorrida("aceitar"));
    declineRideButton.addEventListener("click", () => decidirCorrida("recusar"));

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

        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&bbox=-74,-34,-34,6&limit=50`;

        try {
            const resp = await fetch(url);
            const dados = await resp.json();
            if (!dados.features) return [];

            const items = dados.features
                .filter(f => f.properties.countrycode?.toUpperCase() === "BR")
                .map(f => {
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
                if (iniciarOrientacaoBussola) await iniciarOrientacaoBussola();
                if (selecionarDestino) await selecionarDestino(s);
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
    conectarOfertasCorrida();

    window.addEventListener("beforeunload", () => {
        shuttingDown = true;
        window.clearTimeout(rideReconnectTimeout);
        window.clearInterval(rideHeartbeatInterval);
        if (rideSocket) rideSocket.close();
    });

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
            bearing: 0,
            dragRotate: false,
            keyboard: false
        });
        map.touchZoomRotate.disableRotation();

        // ============================
        // Estado
        // ============================
        let primeiraAtualizacao = true;
        let ultimaLatitude = null;
        let ultimaLongitude = null;
        let watchId = null;
        let watchGeneration = 0;
        let sendIntervalId = null;
        let navigationActive = true;
        let navigationStarted = false;
        let simulacaoAtiva = false;
        let simulacaoIntervalId = null;
        let distanciaSimulada = 0;
        let ultimaAtualizacaoSimulacao = 0;
        const VELOCIDADE_SIMULACAO_KMH = 400;
        const INTERVALO_SIMULACAO_MS = 2;
        let latitudeAntesDaSimulacao = null;
        let longitudeAntesDaSimulacao = null;

        let destinoFixo = null;
        let destinoMarker = null;
        let rotaGeoJSON = null;
        let rotaLatLngs = [];
        let distanciaMaximaRotaAtingida = 0;
        let distanciasAcumuladasRota = [];
        let comprimentoTotalRota = 0;
        let destinoDaRota = null;
        let rotaEmCalculo = false;
        let atualizacoesForaDaRota = 0;
        let ultimoRecalculoPorDesvio = 0;
        const LIMIAR_DESVIO_ROTA_METROS = 50;
        const TEMPO_ENTRE_RECALCULOS_MS = 1000;
        const JANELA_SUAVIZACAO_RUMO_METROS = 8;
        let ultimoRumoBussola = null;
        let bussolaAtiva = false;

        // user marker (carro)
        let userMarker = null;

        // ícone carro
        const ICON_URL = "car.png";
        const ICON2_URL = "arrow.png";
        const ICON_SIZE = 96;


        let lastMarkerUpdate = 0;
        const MARKER_MIN_INTERVAL = 80;

        function obterOffsetDoCarro() {
            const alturaMapa = map.getCanvas().clientHeight;
            const margemInferior = window.innerHeight * 0.10;
            return [0, alturaMapa - margemInferior - alturaMapa / 2];
        }


        let turnPoints = []; // detectados na rota
        let htmlTurnPoints = []; // pool para overlay HTML
        let currentHtmlTurnIndex = null;
        let ultimoRumoCarro = null;
        let rotacionAutomaticaActiva = false;

        // controle de interação do usuário (grab/drag)
        let isUserInteracting = false;
        let resumeTimeout = null;
        let wasSending = false;

        function atualizarOrientacaoBussola(event) {
            let heading = null;
            if (Number.isFinite(event.webkitCompassHeading)) {
                heading = event.webkitCompassHeading;
            } else if ((event.absolute || event.type === "deviceorientationabsolute") &&
                Number.isFinite(event.alpha)) {
                heading = (360 - event.alpha) % 360;
            }
            if (!Number.isFinite(heading)) return;

            ultimoRumoBussola = (heading + 360) % 360;
            if (!navigationActive || isUserInteracting || rotaLatLngs.length > 1 ||
                ultimaLatitude === null || ultimaLongitude === null) return;

            atualizarCameraNavegacao(ultimaLatitude, ultimaLongitude, ultimoRumoBussola);
            atualizarOrientacaoCarro(ultimoRumoBussola);
        }

        iniciarOrientacaoBussola = async () => {
            if (bussolaAtiva || !window.DeviceOrientationEvent) return;

            const orientationEvent = window.DeviceOrientationEvent;
            if (typeof orientationEvent.requestPermission === "function") {
                try {
                    const permission = await orientationEvent.requestPermission();
                    if (permission !== "granted") return;
                } catch (error) {
                    console.error("Erro ao solicitar acesso à bússola:", error);
                    return;
                }
            }

            window.addEventListener("deviceorientation", atualizarOrientacaoBussola);
            window.addEventListener("deviceorientationabsolute", atualizarOrientacaoBussola);
            bussolaAtiva = true;
        };

        if (window.DeviceOrientationEvent &&
            typeof window.DeviceOrientationEvent.requestPermission !== "function") {
            iniciarOrientacaoBussola();
        }

        selecionarDestino = async (sugestao) => {
            if (simulacaoAtiva) pararSimulacao();
            destinoFixo = { lat: parseFloat(sugestao.lat), lon: parseFloat(sugestao.lon) };
            if (!navigationActive || isUserInteracting) return;
            await calcularRota();
            if (navigationStarted && ultimaLatitude !== null && ultimaLongitude !== null) {
                orientarPelaRota(ultimaLatitude, ultimaLongitude);
            }
        };

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
                paint: { "line-color": "#056bf0", "line-width": 10 }
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

        function distanciaAteRota(lat, lon) {
            if (rotaLatLngs.length < 2) return Infinity;

            const R = 6371000;
            const latRad = lat * Math.PI / 180;
            let menorDistancia = Infinity;

            for (let i = 1; i < rotaLatLngs.length; i++) {
                const inicio = rotaLatLngs[i - 1];
                const fim = rotaLatLngs[i];
                const inicioX = (inicio[1] - lon) * Math.PI / 180 * R * Math.cos(latRad);
                const inicioY = (inicio[0] - lat) * Math.PI / 180 * R;
                const fimX = (fim[1] - lon) * Math.PI / 180 * R * Math.cos(latRad);
                const fimY = (fim[0] - lat) * Math.PI / 180 * R;
                const segmentoX = fimX - inicioX;
                const segmentoY = fimY - inicioY;
                const comprimentoQuadrado = segmentoX * segmentoX + segmentoY * segmentoY;
                const proporcao = comprimentoQuadrado === 0
                    ? 0
                    : Math.max(0, Math.min(1,
                        -(inicioX * segmentoX + inicioY * segmentoY) / comprimentoQuadrado
                    ));
                const distancia = Math.hypot(
                    inicioX + proporcao * segmentoX,
                    inicioY + proporcao * segmentoY
                );
                menorDistancia = Math.min(menorDistancia, distancia);
            }

            return menorDistancia;
        }

        function verificarNecessidadeDeRota() {
            if (!navigationActive || isUserInteracting || !destinoFixo ||
                ultimaLatitude === null || ultimaLongitude === null || rotaEmCalculo) return;

            const destinoMudou = !destinoDaRota ||
                destinoDaRota.lat !== destinoFixo.lat ||
                destinoDaRota.lon !== destinoFixo.lon;
            if (rotaLatLngs.length < 2 || destinoMudou) {
                calcularRota();
                return;
            }

            if (distanciaAteRota(ultimaLatitude, ultimaLongitude) > LIMIAR_DESVIO_ROTA_METROS) {
                atualizacoesForaDaRota++;
            } else {
                atualizacoesForaDaRota = 0;
            }

            const agora = Date.now();
            if (atualizacoesForaDaRota >= 2 &&
                agora - ultimoRecalculoPorDesvio >= TEMPO_ENTRE_RECALCULOS_MS) {
                atualizacoesForaDaRota = 0;
                ultimoRecalculoPorDesvio = agora;
                calcularRota();
            }
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

        function distanciaProjetadaNaRota(lat, lon) {
            if (rotaLatLngs.length < 2) return 0;

            const R = 6371000;
            const latitudeRad = lat * Math.PI / 180;
            let menorDistanciaQuadrada = Infinity;
            let distanciaRota = 0;

            for (let i = 1; i < rotaLatLngs.length; i++) {
                const inicio = rotaLatLngs[i - 1];
                const fim = rotaLatLngs[i];
                const inicioX = (inicio[1] - lon) * Math.PI / 180 * R * Math.cos(latitudeRad);
                const inicioY = (inicio[0] - lat) * Math.PI / 180 * R;
                const fimX = (fim[1] - lon) * Math.PI / 180 * R * Math.cos(latitudeRad);
                const fimY = (fim[0] - lat) * Math.PI / 180 * R;
                const segmentoX = fimX - inicioX;
                const segmentoY = fimY - inicioY;
                const comprimentoQuadrado = segmentoX * segmentoX + segmentoY * segmentoY;
                const proporcao = comprimentoQuadrado === 0
                    ? 0
                    : Math.max(0, Math.min(1,
                        -(inicioX * segmentoX + inicioY * segmentoY) / comprimentoQuadrado
                    ));
                const distanciaX = inicioX + proporcao * segmentoX;
                const distanciaY = inicioY + proporcao * segmentoY;
                const distanciaQuadrada = distanciaX * distanciaX + distanciaY * distanciaY;

                if (distanciaQuadrada < menorDistanciaQuadrada) {
                    menorDistanciaQuadrada = distanciaQuadrada;
                    const comprimentoSegmento =
                        distanciasAcumuladasRota[i] - distanciasAcumuladasRota[i - 1];
                    distanciaRota = distanciasAcumuladasRota[i - 1] +
                        proporcao * comprimentoSegmento;
                }
            }

            return distanciaRota;
        }

        function pontoNaRotaPorDistancia(distancia) {
            const distanciaLimitada = Math.max(0, Math.min(distancia, comprimentoTotalRota));
            let indice = 1;
            while (
                indice < distanciasAcumuladasRota.length - 1 &&
                distanciasAcumuladasRota[indice] < distanciaLimitada
            ) {
                indice++;
            }

            const distanciaInicio = distanciasAcumuladasRota[indice - 1] || 0;
            const distanciaFim = distanciasAcumuladasRota[indice] || distanciaInicio;
            const proporcao = distanciaFim === distanciaInicio
                ? 0
                : (distanciaLimitada - distanciaInicio) / (distanciaFim - distanciaInicio);
            const inicio = rotaLatLngs[indice - 1];
            const fim = rotaLatLngs[indice];

            return [
                inicio[0] + (fim[0] - inicio[0]) * proporcao,
                inicio[1] + (fim[1] - inicio[1]) * proporcao
            ];
        }

        function atualizarProgressoRota() {
            if (rotaLatLngs.length < 2 || comprimentoTotalRota <= 0 ||
                ultimaLatitude === null || ultimaLongitude === null) return;

            const indiceAtual = pontoMaisProximo(ultimaLatitude, ultimaLongitude);
            const distanciaPercorrida = distanciasAcumuladasRota[indiceAtual] || 0;
            const progresso = Math.min(100, Math.max(0,
                Math.round(distanciaPercorrida / comprimentoTotalRota * 100)
            ));

            routeProgress.hidden = false;
            routeProgress.setAttribute("aria-valuenow", String(progresso));
            routeProgressFill.style.width = `${progresso}%`;
            routeProgressLabel.textContent = `${progresso}%`;
        }

        function calcularRumoAdianteNaRota(lat, lon) {
            if (rotaLatLngs.length < 2) return null;

            distanciaMaximaRotaAtingida = Math.max(
                distanciaMaximaRotaAtingida,
                distanciaProjetadaNaRota(lat, lon)
            );

            const distanciaFinal = distanciaMaximaRotaAtingida;
            const distanciaInicial = Math.max(
                0,
                distanciaFinal - JANELA_SUAVIZACAO_RUMO_METROS
            );
            if (distanciaFinal - distanciaInicial < 0.5) {
                return calcularBearing(
                    rotaLatLngs[0][0],
                    rotaLatLngs[0][1],
                    rotaLatLngs[1][0],
                    rotaLatLngs[1][1]
                );
            }

            const inicio = pontoNaRotaPorDistancia(distanciaInicial);
            const fim = pontoNaRotaPorDistancia(distanciaFinal);
            return calcularBearing(inicio[0], inicio[1], fim[0], fim[1]);
        }

        // ============================
        // ORIENTAR MAPA E CARRO PELA ROTA
        // ============================
        function orientarPelaRota(lat, lon) {
            if (rotaLatLngs.length < 2) return;
            const bearing = calcularRumoAdianteNaRota(lat, lon);
            if (bearing !== null) {
                atualizarCameraNavegacao(lat, lon, bearing);
                atualizarOrientacaoCarro(bearing);
            }
        }

        // ============================
        // CRIAR E ATUALIZAR MARKER DO CARRO (cria apenas uma vez)
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

            const img = document.createElement("img");
            img.src = srcUrl;           // define uma vez
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "contain";
            img.style.transformOrigin = "center center";
            img.style.willChange = "transform";
            img.style.backfaceVisibility = "hidden";
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
            if (ultimoRumoCarro !== null) {
                atualizarOrientacaoCarro(ultimoRumoCarro);
            }
        }

        function atualizarOrientacaoCarro(bearing) {
            if (!Number.isFinite(bearing)) return;
            ultimoRumoCarro = (bearing + 360) % 360;
            const img = userMarker && userMarker.getElement().querySelector("img");
            if (img) {
                const mapBearing = typeof map.getBearing === "function" ? map.getBearing() : 0;
                const screenBearing = ((ultimoRumoCarro - mapBearing + 540) % 360) - 180;
                img.style.transform = `rotate(${screenBearing}deg)`;
            }
        }

        function atualizarCameraNavegacao(lat, lon, targetBearing) {
            if (!Number.isFinite(targetBearing) || isUserInteracting) return;
            rotacionAutomaticaActiva = true;
            map.easeTo({
                center: [lon, lat],
                bearing: (targetBearing + 360) % 360,
                zoom: navigationStarted ? 17 : map.getZoom(),
                offset: obterOffsetDoCarro(),
                duration: 250,
                easing: t => 1 - Math.pow(1 - t, 3)
            });
            if (!map.isMoving()) rotacionAutomaticaActiva = false;
        }

        // versão throttled para reduzir flicker
        function atualizarUserMarkerThrottled(lat, lon) {
            const now = Date.now();
            if (now - lastMarkerUpdate < MARKER_MIN_INTERVAL) {
                // ainda atualiza a posição (sem recriar), mas evita operações pesadas
                if (userMarker) userMarker.setLngLat([lon, lat]);
                return;
            }
            lastMarkerUpdate = now;
            atualizarUserMarker(lat, lon);
        }

        // ============================
        // OVERLAY HTML DE SETAS (pool)
        // ============================
        function criarOverlaySetasHTML() {
            if (document.getElementById("turn-overlay")) return;
            const container = document.createElement("div");
            container.id = "turn-overlay";
            container.style.pointerEvents = "none";
            container.innerHTML = `
              <div id="turn-arrow">
                <div class="arrow-icon"></div>
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

            const icon = overlay.querySelector(".arrow-icon");
            switch (tp.type) {
                case "left": icon.textContent = "turn_left"; break;
                case "right": icon.textContent = "turn_right"; break;
                default: icon.textContent = "arrow_forward";
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

        function detectarPontosDeVirada() {
            turnPoints = [];
            if (!rotaLatLngs || rotaLatLngs.length < 3) return;

            const ANGLE_THRESHOLD = 25;          // ângulo mínimo para considerar curva
            const MIN_SEGMENT_DISTANCE = 5;      // distância mínima entre pontos

            for (let i = 1; i < rotaLatLngs.length - 1; i++) {
                const prev = rotaLatLngs[i - 1];
                const cur = rotaLatLngs[i];
                const next = rotaLatLngs[i + 1];

                const b1 = calcularBearing(prev[0], prev[1], cur[0], cur[1]);
                const b2 = calcularBearing(cur[0], cur[1], next[0], next[1]);

                let diff = b2 - b1;
                diff = ((diff + 540) % 360) - 180; // normaliza para -180..180
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
                        street: "" // opcional
                    });

                    atualizarSetaDirecao(type);
                } else {
                    atualizarSetaDirecao("straight");
                }
            }
        }

        function atualizarSetaDirecao(type) {
            const arrowIcon = document.querySelector(".arrow-icon");
            if (!arrowIcon) return;

            switch (type) {
                case "left":
                    arrowIcon.textContent = "turn_left";
                    break;
                case "right":
                    arrowIcon.textContent = "turn_right";
                    break;
                case "straight":
                    arrowIcon.textContent = "arrow_forward";
                    break;
                default:
                    arrowIcon.textContent = "arrow_forward";
            }
        }



        // ============================
        // PAUSA E RETOMA DE TAREFAS PESADAS DURANTE INTERAÇÃO DO USUÁRIO
        // ============================
        function pauseHeavyWork() {
            if (!navigationActive || isUserInteracting) return;
            isUserInteracting = true;
            if (sendIntervalId !== null) {
                wasSending = true;
                clearInterval(sendIntervalId);
                sendIntervalId = null;
            } else {
                wasSending = false;
            }
            statusDiv.textContent = "Interação do usuário";
        }

        function resumeHeavyWorkDebounced(delay = 300) {
            if (!navigationActive) return;
            if (resumeTimeout) clearTimeout(resumeTimeout);
            resumeTimeout = setTimeout(() => {
                resumeHeavyWork();
                resumeTimeout = null;
            }, delay);
        }

        function resumeHeavyWork() {
            if (!navigationActive) {
                isUserInteracting = false;
                return;
            }
            if (!isUserInteracting) return;
            isUserInteracting = false;
            if (wasSending && sendIntervalId === null) {
                enviarPosicao();
                sendIntervalId = setInterval(enviarPosicao, 5000);
            }
            if (navigationStarted && ultimaLatitude !== null &&
                ultimaLongitude !== null && rotaLatLngs.length > 1) {
                orientarPelaRota(ultimaLatitude, ultimaLongitude);
            }
            verificarNecessidadeDeRota();
            if (navigationStarted || rotaLatLngs.length < 2) {
                statusDiv.textContent = "Tudo Certo!";
            }
        }

        // MapLibre interaction events
        map.on("dragstart", () => pauseHeavyWork());
        map.on("dragend", () => resumeHeavyWorkDebounced(300));
        map.on("movestart", () => {
            if (!rotacionAutomaticaActiva) pauseHeavyWork();
        });
        map.on("moveend", () => {
            if (!rotacionAutomaticaActiva) resumeHeavyWorkDebounced(300);
            rotacionAutomaticaActiva = false;
        });
        map.on("rotate", () => {
            if (ultimoRumoCarro !== null) atualizarOrientacaoCarro(ultimoRumoCarro);
        });
        map.on("rotateend", () => {
            rotacionAutomaticaActiva = false;
            if (ultimoRumoCarro !== null) atualizarOrientacaoCarro(ultimoRumoCarro);
        });

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
            if (!navigationActive || ultimaLatitude === null || ultimaLongitude === null) return;
            const motoristaId = localStorage.getItem("id_motorista");
            if (!motoristaId) {
                statusDiv.textContent = "ID do motorista ausente";
                return;
            }
            statusDiv.textContent = "Enviando...";
            const payload = {
                pessoa: Number(motoristaId),
                lat: ultimaLatitude,
                lon: ultimaLongitude,
                data: dataHoraBrasil()
            };
            try {
                const resp = await fetch(`${apiBaseUrl}/input`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                if (!resp.ok) throw new Error("Resposta não OK: " + resp.status);
                if (navigationActive) statusDiv.textContent = "Localização enviada";
            } catch (err) {
                console.error("Erro ao enviar posição:", err);
                if (navigationActive) statusDiv.textContent = "Erro ao enviar";
            }
        }

        function iniciarEnvioPeriodico() {
            if (!navigationActive || sendIntervalId !== null) return;
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
        // CALCULAR ROTA (OSRM)
        // ============================
        async function calcularRota() {
            if (!navigationActive || rotaEmCalculo) return;
            if (ultimaLatitude === null || ultimaLongitude === null) {
                statusDiv.textContent = "Aguardando localização...";
                return;
            }
            if (!destinoFixo) {
                statusDiv.textContent = "Digite um destino.";
                return;
            }

            const destinoCalculado = { ...destinoFixo };
            const url = `https://router.project-osrm.org/route/v1/driving/${ultimaLongitude},${ultimaLatitude};${destinoCalculado.lon},${destinoCalculado.lat}?overview=full&geometries=geojson`;

            rotaEmCalculo = true;
            simulateRouteToggle.disabled = true;
            try {
                statusDiv.textContent = "Calculando rota...";
                const response = await fetch(url);
                if (!navigationActive) return;
                const data = await response.json();
                if (!navigationActive) return;

                if (!data.routes || !data.routes[0] || !data.routes[0].geometry) {
                    throw new Error("Resposta de rota inválida");
                }

                const coords = data.routes[0].geometry.coordinates; // [lon, lat]
                rotaLatLngs = coords.map(c => [c[1], c[0]]);
                distanciaMaximaRotaAtingida = 0;
                distanciasAcumuladasRota = [0];
                for (let i = 1; i < rotaLatLngs.length; i++) {
                    const anterior = rotaLatLngs[i - 1];
                    const atual = rotaLatLngs[i];
                    distanciasAcumuladasRota.push(
                        distanciasAcumuladasRota[i - 1] +
                        distanciaEmMetros(anterior[0], anterior[1], atual[0], atual[1])
                    );
                }
                comprimentoTotalRota = distanciasAcumuladasRota[distanciasAcumuladasRota.length - 1] || 0;
                destinoDaRota = destinoCalculado;
                atualizacoesForaDaRota = 0;
                atualizarProgressoRota();

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
                        paint: { "line-color": "#1976d2", "line-width": 10 }
                    });
                }

                if (!navigationStarted) {
                    const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
                    coords.forEach(coord => bounds.extend(coord));
                    rotacionAutomaticaActiva = true;
                    map.fitBounds(bounds, {
                        padding: {
                            top: 150,
                            right: 48,
                            bottom: Math.min(360, map.getCanvas().clientHeight * 0.55),
                            left: 48
                        },
                        maxZoom: 16,
                        duration: 700
                    });
                    if (!map.isMoving()) rotacionAutomaticaActiva = false;
                    startRouteButton.hidden = false;
                    startRouteButton.disabled = false;
                    statusDiv.textContent = "Rota pronta. Toque em Ir para iniciar.";
                } else {
                    statusDiv.textContent = "Rota calculada";
                }
                simulateRouteToggle.disabled = !navigationActive || rotaLatLngs.length < 2;

                if (navigationStarted && navigationActive &&
                    ultimaLatitude !== null && ultimaLongitude !== null) {
                    orientarPelaRota(ultimaLatitude, ultimaLongitude);
                }

            } catch (err) {
                console.error("Erro ao calcular rota:", err);
                simulateRouteToggle.disabled = rotaLatLngs.length < 2;
                if (navigationActive) statusDiv.textContent = "Erro ao calcular rota";
            } finally {
                rotaEmCalculo = false;
                simulateRouteToggle.disabled = !navigationActive || rotaLatLngs.length < 2;
            }
        }

        // ============================
        // ATUALIZAÇÃO DE LOCALIZAÇÃO (watchPosition)
        // ============================
        // Substitua sua função atualizarLocalizacao por esta
        function atualizarLocalizacao(pos) {
            if (!navigationActive || simulacaoAtiva !== Boolean(pos.simulada)) return;
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            ultimaLatitude = lat;
            ultimaLongitude = lon;
            statusDiv.textContent = pos.simulada
                ? "Simulação da rota em andamento"
                : "Localização atualizada";
            atualizarProgressoRota();

            // atualiza marker (throttled)
            atualizarUserMarkerThrottled(lat, lon);

            let routeBearing = null;
            if (rotaLatLngs.length > 1) {
                routeBearing = calcularRumoAdianteNaRota(lat, lon);
            }
            const navigationBearing = routeBearing !== null
                ? routeBearing
                : ultimoRumoBussola !== null
                    ? ultimoRumoBussola
                    : Number.isFinite(pos.coords.heading)
                        ? pos.coords.heading
                        : null;

            // primeira vez: centraliza e define zoom
            if (primeiraAtualizacao) {
                map.jumpTo({
                    center: [lon, lat],
                    zoom: 17,
                    bearing: navigationBearing === null ? map.getBearing() : navigationBearing,
                    offset: obterOffsetDoCarro()
                });
                primeiraAtualizacao = false;
            } else if (!isUserInteracting &&
                (navigationStarted || rotaLatLngs.length < 2)) {
                if (navigationBearing !== null) {
                    atualizarCameraNavegacao(lat, lon, navigationBearing);
                } else {
                    map.panTo([lon, lat], {
                        offset: obterOffsetDoCarro(),
                        duration: 300
                    });
                }
            }

            // se houver rota, calcula rumo à frente (próximo segmento)
            if (navigationBearing !== null) {
                atualizarOrientacaoCarro(navigationBearing);
                // atualiza overlay de setas
                if (rotaLatLngs.length > 1) checarPassagemSetaHTML();
            }

            if (!pos.simulada) {
                verificarNecessidadeDeRota();
                iniciarEnvioPeriodico();
            }
        }

        function tratarErroGeolocalizacao(err) {
            if (!navigationActive) return;
            console.error("Erro geolocalização:", err.code, err.message);
            if (err.code === 1) statusDiv.textContent = "Permissão negada.";
            else if (err.code === 2) statusDiv.textContent = "Posição indisponível.";
            else if (err.code === 3) statusDiv.textContent = "Tempo esgotado.";
        }

        function iniciarWatch() {
            if (!navigationActive || watchId !== null) return;
            if (!("geolocation" in navigator)) {
                statusDiv.textContent = "Geolocalização não suportada.";
                return;
            }
            const generation = ++watchGeneration;
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    if (!navigationActive || generation !== watchGeneration) return;
                    atualizarLocalizacao(pos);
                    if (watchId === null) {
                        watchId = navigator.geolocation.watchPosition(
                            (position) => {
                                if (generation === watchGeneration) atualizarLocalizacao(position);
                            },
                            (error) => {
                                if (generation === watchGeneration) tratarErroGeolocalizacao(error);
                            },
                            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
                        );
                    }
                },
                (error) => {
                    if (generation === watchGeneration) tratarErroGeolocalizacao(error);
                },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
            );
        }

        function obterPosicaoNaRota(distancia) {
            let indice = 1;
            while (
                indice < distanciasAcumuladasRota.length - 1 &&
                distanciasAcumuladasRota[indice] < distancia
            ) {
                indice++;
            }

            const distanciaInicio = distanciasAcumuladasRota[indice - 1] || 0;
            const distanciaFim = distanciasAcumuladasRota[indice] || distanciaInicio;
            const proporcao = distanciaFim === distanciaInicio
                ? 0
                : (distancia - distanciaInicio) / (distanciaFim - distanciaInicio);
            const inicio = rotaLatLngs[indice - 1];
            const fim = rotaLatLngs[indice];

            return {
                coords: {
                    latitude: inicio[0] + (fim[0] - inicio[0]) * proporcao,
                    longitude: inicio[1] + (fim[1] - inicio[1]) * proporcao,
                    heading: calcularBearing(inicio[0], inicio[1], fim[0], fim[1])
                },
                simulada: true
            };
        }

        function atualizarSimulacao() {
            const agora = performance.now();
            distanciaSimulada +=
                (agora - ultimaAtualizacaoSimulacao) * VELOCIDADE_SIMULACAO_KMH / 3600;
            ultimaAtualizacaoSimulacao = agora;

            if (distanciaSimulada >= comprimentoTotalRota) {
                distanciaSimulada = comprimentoTotalRota;
                atualizarLocalizacao(obterPosicaoNaRota(distanciaSimulada));
                pararSimulacao();
                statusDiv.textContent = "Simulação concluída";
                return;
            }

            atualizarLocalizacao(obterPosicaoNaRota(distanciaSimulada));
        }

        function pararSimulacao(retomarGps = true) {
            if (!simulacaoAtiva) return;
            simulacaoAtiva = false;
            if (simulacaoIntervalId !== null) {
                clearInterval(simulacaoIntervalId);
                simulacaoIntervalId = null;
            }
            simulateRouteToggle.textContent = "Simular";
            simulateRouteToggle.setAttribute("aria-pressed", "false");
            pararEnvioPeriodico();

            if (latitudeAntesDaSimulacao !== null && longitudeAntesDaSimulacao !== null) {
                ultimaLatitude = latitudeAntesDaSimulacao;
                ultimaLongitude = longitudeAntesDaSimulacao;
            }
            latitudeAntesDaSimulacao = null;
            longitudeAntesDaSimulacao = null;
            distanciaMaximaRotaAtingida = ultimaLatitude !== null && ultimaLongitude !== null
                ? distanciaProjetadaNaRota(ultimaLatitude, ultimaLongitude)
                : 0;

            if (retomarGps && navigationActive) {
                watchGeneration++;
                if (watchId !== null) {
                    navigator.geolocation.clearWatch(watchId);
                    watchId = null;
                }
                statusDiv.textContent = "Retomando GPS...";
                iniciarWatch();
            }
        }

        function iniciarSimulacao() {
            if (simulacaoAtiva) {
                pararSimulacao();
                return;
            }
            if (!navigationActive || rotaEmCalculo || rotaLatLngs.length < 2 ||
                comprimentoTotalRota <= 0) return;

            latitudeAntesDaSimulacao = ultimaLatitude;
            longitudeAntesDaSimulacao = ultimaLongitude;
            simulacaoAtiva = true;
            distanciaSimulada = 0;
            distanciaMaximaRotaAtingida = 0;
            ultimaAtualizacaoSimulacao = performance.now();
            watchGeneration++;
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
            pararEnvioPeriodico();
            wasSending = false;
            simulateRouteToggle.textContent = "Stop";
            simulateRouteToggle.setAttribute("aria-pressed", "true");
            statusDiv.textContent = "Simulação da rota em andamento";
            atualizarLocalizacao(obterPosicaoNaRota(0));
            simulacaoIntervalId = setInterval(atualizarSimulacao, INTERVALO_SIMULACAO_MS);
        }

        simulateRouteToggle.addEventListener("click", iniciarSimulacao);

        function atualizarEstadoBotoesNavegacao() {
            navigationToggle.setAttribute("aria-checked", String(navigationActive));
            navigationToggle.setAttribute(
                "aria-label",
                navigationActive ? "Desativar navegação" : "Ativar navegação"
            );
            navigationToggleLabel.textContent = navigationActive ? "Nav" : "Stop";
            simulateRouteToggle.disabled = !navigationActive || rotaLatLngs.length < 2;
        }

        function pausarNavegacao() {
            if (!navigationActive) return;
            pararSimulacao(false);
            navigationActive = false;
            watchGeneration++;

            if (resumeTimeout !== null) {
                clearTimeout(resumeTimeout);
                resumeTimeout = null;
            }
            isUserInteracting = false;
            wasSending = false;
            pararEnvioPeriodico();
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
            map.stop();
            atualizarEstadoBotoesNavegacao();
            statusDiv.textContent = "Modo explorar";
        }

        function retomarNavegacao() {
            if (navigationActive) return;
            navigationActive = true;
            atualizarEstadoBotoesNavegacao();
            statusDiv.textContent = "Retornando";
            iniciarWatch();
        }

        navigationToggle.addEventListener("click", () => {
            if (navigationActive) {
                pausarNavegacao();
            } else {
                retomarNavegacao();
            }
        });

        startRouteButton.addEventListener("click", () => {
            if (rotaLatLngs.length < 2) return;
            navigationStarted = true;
            startRouteButton.hidden = true;
            statusDiv.textContent = "Navegação iniciada";
            if (ultimaLatitude !== null && ultimaLongitude !== null) {
                orientarPelaRota(ultimaLatitude, ultimaLongitude);
            }
        });

        // ============================
        // BOTÃO "IR" (geocodifica e calcula rota)
        // ============================
        btnIr.addEventListener("click", async () => {
            if (simulacaoAtiva) pararSimulacao();
            if (iniciarOrientacaoBussola) await iniciarOrientacaoBussola();
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

            if (navigationActive && !isUserInteracting) {
                await calcularRota();
                if (navigationStarted && ultimaLatitude !== null && ultimaLongitude !== null) {
                    orientarPelaRota(ultimaLatitude, ultimaLongitude);
                }
            }
        });

        // ============================
        // GEOCODIFICAÇÃO (PHOTON) - para botão IR
        // ============================
        async function geocodificarEndereco(endereco) {
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(endereco)}&bbox=-74,-34,-34,6&limit=10`;

            try {
                const resp = await fetch(url);
                const dados = await resp.json();
                const featureBrasil = dados.features?.find(
                    f => f.properties.countrycode?.toUpperCase() === "BR"
                );
                if (!featureBrasil) {
                    alert("Endereço não encontrado.");
                    return null;
                }
                return {
                    lat: featureBrasil.geometry.coordinates[1],
                    lon: featureBrasil.geometry.coordinates[0]
                };
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
        atualizarEstadoBotoesNavegacao();
        iniciarWatch();

        // cleanup on unload
        window.addEventListener("beforeunload", function () {
            navigationActive = false;
            watchGeneration++;
            if (simulacaoIntervalId !== null) clearInterval(simulacaoIntervalId);
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            pararEnvioPeriodico();
        });

      
        window.__debugMap = {
            map, calcularRota, detectarPontosDeVirada, rotaLatLngs
        };
    }
});
