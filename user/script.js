document.addEventListener("DOMContentLoaded", function () {

    const map = L.map("map").setView([0, 0], 2);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 25,
        attribution: "© OpenStreetMap"
    }).addTo(map);

    const statusDiv = document.getElementById("status");

    let marker = null;
    let firstUpdate = true;

    // last known position
    let ultimaLatitude = null;
    let ultimaLongitude = null;

    function atualizarLocalizacao(pos) {

        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        ultimaLatitude = lat;
        ultimaLongitude = lon;

        statusDiv.innerHTML = "Localização atualizada";

        if (!marker) {

            marker = L.marker([lat, lon])
                .addTo(map)
                .bindPopup("Você está aqui!");

        } else {

            marker.setLatLng([lat, lon]);

        }

        if (firstUpdate) {
            map.setView([lat, lon], 17);
            firstUpdate = false;
        } else {
            map.panTo([lat, lon]);
        }

    }

    function erro() {
        statusDiv.innerHTML = "Não foi possível obter sua localização.";
    }

    // Observa a posicao satanica
    if (navigator.geolocation) {

        navigator.geolocation.watchPosition(
            atualizarLocalizacao,
            erro,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );

    } else {

        statusDiv.innerHTML = "Geolocalização não suportada pelo navegador.";

    }

    // Envia para a API a cada 5 segundos
    setInterval(() => {

        if (ultimaLatitude === null || ultimaLongitude === null) {
            return;
        }

        statusDiv.innerHTML = "Enviando...";

        fetch("https://api-amigos-pelo-mundo.onrender.com/input", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                pessoa: localStorage.getItem('nome') || "Desconhecido",
                lat: ultimaLatitude,
                lon: ultimaLongitude
            })
        })
        .then(response => response.json())
        .then(() => {
            statusDiv.innerHTML = "Localização enviada";
        })
        .catch(err => {
            console.error(err);
            statusDiv.innerHTML = "Erro ao enviar";
        });

    }, 5000);

});