document.addEventListener("DOMContentLoaded", function () {

    const statusDiv = document.getElementById("status");
    const inputDestino = document.getElementById("destino-input");
    const lista = document.getElementById("autocomplete-list");

    // ============================

    async function buscarSugestoes(query) {
        if (!query || query.length < 3) return [];

        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;

        try {
            const resp = await fetch(url);
            const dados = await resp.json();

            return dados.features.map(f => ({
                display_name: f.properties.name + ", " + (f.properties.city || ""),
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0]
            }));
        } catch (e) {
            console.error("Erro ao buscar sugestões:", e);
            return [];
        }
    }


    inputDestino.addEventListener("input", async () => {
        const texto = inputDestino.value.trim();
        lista.innerHTML = "";

        if (texto.length < 3) return;

        const sugestoes = await buscarSugestoes(texto);

        sugestoes.forEach(s => {
            const item = document.createElement("div");
            item.textContent = s.display_name;

            item.addEventListener("click", () => {
                inputDestino.value = s.display_name;
                lista.innerHTML = "";

                destinoFixo = {
                    lat: parseFloat(s.lat),
                    lon: parseFloat(s.lon)
                };

                calcularRota();
            });

            lista.appendChild(item);
        });
    });

    // ============================
    // LEAFLET READY
    // ============================
    function whenLeafletReady(cb, timeout = 5000) {
        const start = Date.now();
        (function check() {
            if (typeof L !== "undefined") return cb();
            if (Date.now() - start > timeout) {
                statusDiv.textContent = "Erro: biblioteca de mapas não carregou.";
                return;
            }
            setTimeout(check, 100);
        })();
    }

    whenLeafletReady(initMap);

    // ============================
    // MAPA
    // ============================
    function initMap() {

        const rotatingDiv = document.getElementById("map-rotating");

        const map = L.map("map", { zoomControl: false }).setView([-14.235, -51.925], 4);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 25,
            attribution: "© OpenStreetMap"
        }).addTo(map);

        let marker = null;
        let primeiraAtualizacao = true;
        let ultimaLatitude = null;
        let ultimaLongitude = null;
        let watchId = null;

        let destinoFixo = null;
        let destinoMarker = null;
        let rotaPolyline = null;
        let rotaLatLngs = [];

        // ============================
        // BEARING ENTRE DOIS PONTOS
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
        // ORIENTAR MAPA PELA ROTA
        // ============================
        function orientarPelaRota(lat, lon) {

            if (rotaLatLngs.length < 2) return;

            const idx = pontoMaisProximo(lat, lon);
            const proxIdx = Math.min(idx + 1, rotaLatLngs.length - 1);
            const prox = rotaLatLngs[proxIdx];

            const bearing = calcularBearing(lat, lon, prox[0], prox[1]);

            const anguloMapa = -bearing;

            rotatingDiv.style.transform = `rotate(${anguloMapa}deg)`;
        }

        // ============================
        // GEOCODIFICAÇÃO
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

                return {
                    lat: f.geometry.coordinates[1],
                    lon: f.geometry.coordinates[0]
                };

            } catch (err) {
                console.error("Erro ao geocodificar:", err);
                alert("Erro ao buscar endereço.");
                return null;
            }
        }


        // ============================
        // DESTINO DINÂMICO
        // ============================
        document.getElementById("btn-ir").addEventListener("click", async () => {
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

            destinoMarker = L.marker([destino.lat, destino.lon])
                .addTo(map)
                .bindPopup("Destino");

            calcularRota();
        });

        // ============================
        // CALCULAR ROTA
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

                const coords = data.routes[0].geometry.coordinates;
                rotaLatLngs = coords.map(c => [c[1], c[0]]);

                if (rotaPolyline) rotaPolyline.remove();

                rotaPolyline = L.polyline(rotaLatLngs, {
                    color: "blue",
                    weight: 5
                }).addTo(map);

                map.setView([ultimaLatitude, ultimaLongitude], 17);

                statusDiv.textContent = "Rota calculada";

            } catch (err) {
                console.error("Erro ao calcular rota:", err);
                statusDiv.textContent = "Erro ao calcular rota";
            }
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

            if (!marker) {
                marker = L.marker([lat, lon]).addTo(map).bindPopup("Você está aqui!");
            } else {
                marker.setLatLng([lat, lon]);
            }

            orientarPelaRota(lat, lon);

            if (primeiraAtualizacao) {
                map.setView([lat, lon], 17);
                primeiraAtualizacao = false;
                calcularRota();
            } else {
                map.panTo([lat, lon]);
                calcularRota();
            }
        }

        function tratarErroGeolocalizacao(err) {
            statusDiv.textContent = "Erro ao obter localização.";
        }

        function iniciarWatch() {
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
    }
});
