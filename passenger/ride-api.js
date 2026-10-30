window.RideApi = (() => {
    const apiBaseUrl = 'https://api-checkin-s376.onrender.com';
    const routeInsertUrl = `${apiBaseUrl}/insert_route`;
    const rideApiUrl = `${apiBaseUrl}/oferta_corrida`;
    let sendingRide = false;
    let rideStatusInterval = null;

    async function sendRide(ride) {
        if (sendingRide) {
            throw new Error('Uma solicitação de corrida já está sendo enviada.');
        }

        sendingRide = true;
        try {
            const insertResponse = await fetch(routeInsertUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id_passageiro: ride.id_passageiro,
                    id_motorista: ride.id_motorista,
                    lat_origem: ride.lat,
                    lon_origem: ride.lon,
                    lat_destino: ride.destino_lat,
                    lon_destino: ride.destino_lon,
                    phase: 1
                })
            });
            let insertResult;
            try {
                insertResult = await insertResponse.json();
            } catch {
                throw new Error('O servidor retornou uma resposta inválida ao salvar a rota.');
            }
            if (!insertResponse.ok) {
                const detail = insertResult && (insertResult.error || insertResult.detail);
                const errorMessage = Array.isArray(detail)
                    ? detail.map((item) => item.msg).filter(Boolean).join(' ')
                    : detail;
                throw new Error(errorMessage || `A API de rotas respondeu com status ${insertResponse.status}.`);
            }
            const routeId = insertResult?.data?.insertId ?? insertResult?.insertId ?? insertResult?.id_rota;
            if (routeId === undefined || routeId === null || routeId === 0) {
                throw new Error('A API salvou a rota, mas não retornou o ID necessário para enviar a oferta ao motorista.');
            }

            const response = await fetch(rideApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ride, id_rota: routeId })
            });
            let result;
            try {
                result = await response.json();
            } catch {
                throw new Error('O servidor retornou uma resposta inválida ao enviar a oferta ao motorista.');
            }
            if (!response.ok || !result || result.success !== true) {
                const detail = result && (result.message || result.error || result.detail);
                throw new Error(detail || `A API de corridas respondeu com status ${response.status}.`);
            }
            return routeId;
        } finally {
            sendingRide = false;
        }
    }

    function watchRideStatus(routeId, passengerId, onStatusChange) {
        window.clearInterval(rideStatusInterval);
        let checkingStatus = false;
        const checkStatus = async () => {
            if (checkingStatus) return;
            checkingStatus = true;
            let status;
            try {
                const query = new URLSearchParams({ id_passageiro: passengerId });
                const response = await fetch(`${rideApiUrl}/${encodeURIComponent(routeId)}?${query}`, {
                    cache: 'no-store'
                });
                if (!response.ok) throw new Error(`A API de corridas respondeu com status ${response.status}.`);
                const result = await response.json();
                const ride = result?.data?.ride ?? result?.data ?? result?.ride ?? result;
                const rawStatus = ride?.status ?? ride?.status_corrida ?? ride?.situacao;
                if (typeof rawStatus === 'string') status = rawStatus.trim().toLowerCase();
            } catch (error) {
                console.error('Erro ao consultar o status da corrida:', error);
            } finally {
                checkingStatus = false;
            }

            if (status === 'aceita' || status === 'recusada' || status === 'cancelada') {
                window.clearInterval(rideStatusInterval);
                rideStatusInterval = null;
                onStatusChange(status);
            }
        };

        rideStatusInterval = window.setInterval(checkStatus, 5000);
        checkStatus();
    }

    return {
        baseUrl: apiBaseUrl,
        sendRide,
        watchRideStatus
    };
})();
