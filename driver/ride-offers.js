window.RideOffers = {
    initialize(apiBaseUrl, onRideAccepted) {
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
        const driverId = localStorage.getItem("id_motorista");
        const rideSocketUrl = `${apiBaseUrl.replace(/^http/, "ws")}/ws/driver?id_motorista=${encodeURIComponent(driverId || "")}`;
        let rideSocket = null;
        let rideReconnectTimeout = null;
        let rideHeartbeatInterval = null;
        let currentRideId = null;
        let currentRide = null;
        let shuttingDown = false;
        let decidingRide = false;

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

        function normalizarCoordenada(value, limite) {
            if (value === null || value === undefined || value === "") return null;
            const coordinate = Number(value);
            return Number.isFinite(coordinate) && Math.abs(coordinate) <= limite ? coordinate : null;
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
            const originData = originValue && typeof originValue === "object" ? originValue : data;
            const pickupLatitude = normalizarCoordenada(obterCampo(data, [
                "lat_origem", "origem_lat", "latitude_origem", "pickup_lat", "pickup_latitude", "lat", "latitude"
            ]) ?? obterCampo(originData, ["lat", "latitude"]), 90);
            const pickupLongitude = normalizarCoordenada(obterCampo(data, [
                "lon_origem", "origem_lon", "longitude_origem", "pickup_lon", "pickup_longitude", "lon", "lng", "longitude"
            ]) ?? obterCampo(originData, ["lon", "lng", "longitude"]), 180);

            return {
                id: obterCampo(data, ["id_rota"]) ?? obterCampo(payload, ["id_rota"]) ?? obterCampo(data, ["id"]),
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
                destination: textoDoLocal(destinationValue) || "Destino não informado",
                pickupLatitude,
                pickupLongitude
            };
        }

        function mostrarOfertaCorrida(payload) {
            const ride = normalizarCorrida(payload);
            currentRide = ride;
            currentRideId = ride.id;

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

            const acceptedRide = currentRide;
            if (decisao === "aceitar" &&
                (!acceptedRide || acceptedRide.pickupLatitude === null || acceptedRide.pickupLongitude === null)) {
                rideFeedback.textContent = "A oferta não contém as coordenadas do passageiro. Não é possível traçar a rota.";
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
                    currentRideId = null;
                    rideCard.hidden = true;
                    try {
                        await onRideAccepted(acceptedRide);
                    } catch (error) {
                        console.error("Erro ao iniciar a rota até o passageiro:", error);
                        rideFeedback.textContent = `Corrida aceita, mas não foi possível iniciar a rota: ${error.message}`;
                        rideFeedback.classList.add("is-error");
                    }
                } else {
                    rideFeedback.textContent = "Oferta recusada. O passageiro poderá escolher outro motorista.";
                    rideCard.hidden = true;
                    dismissedMessage.hidden = false;
                    currentRideId = null;
                }
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

        acceptRideButton.addEventListener("click", () => decidirCorrida("aceitou"));
        declineRideButton.addEventListener("click", () => decidirCorrida("recusou"));

        conectarOfertasCorrida();

        window.addEventListener("beforeunload", () => {
            shuttingDown = true;
            window.clearTimeout(rideReconnectTimeout);
            window.clearInterval(rideHeartbeatInterval);
            if (rideSocket) rideSocket.close();
        });
    }
};
