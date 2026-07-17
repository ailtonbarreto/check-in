let map;
let marcadores = {};

document.addEventListener("DOMContentLoaded", function () {

    const iconVerde = () => L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const iconLaranja = () => L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    function plotarPessoasNoMapa() {

        fetch("https://api-checkin-7zte.onrender.com/localizacoes")
            .then(response => response.json())
            .then(response => {

                const pessoas = response.data;
                if (!pessoas || pessoas.length === 0) return;

                if (!map) {
                    map = L.map("map").setView([pessoas[0].lat, pessoas[0].lon], 12);
                    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                        attribution: "&copy; OpenStreetMap contributors"
                    }).addTo(map);
                    map.zoomControl.remove();

                }

                const agora = new Date();

                const pessoasAtuais = new Set();

                let qtdVerdes = 0;

                pessoas.forEach(pessoa => {

                    const id = pessoa.pessoa;
                    pessoasAtuais.add(id);

                    let dataRegistro = new Date(pessoa.data);
                    dataRegistro = new Date(dataRegistro.getTime() + (3 * 60 * 60 * 1000));

                    let diffSegundos = (agora - dataRegistro) / 1000;
                    if (diffSegundos < 0) diffSegundos = 0;

                    const icon = diffSegundos > 120 ? iconLaranja() : iconVerde();

                    // Conta quantos estão verdes
                    if (diffSegundos <= 120) {
                        qtdVerdes++;
                    }

                    if (marcadores[id]) {
                        map.removeLayer(marcadores[id]);
                    }

                    marcadores[id] = L.marker([pessoa.lat, pessoa.lon], { icon })
                        .bindPopup(`<strong>${pessoa.pessoa}</strong>`)
                        .addTo(map);
                });

                // Atualiza o HTML
                document.getElementById("qtd_online").innerHTML = qtdVerdes;


                // Remove quem sumiu da API
                Object.keys(marcadores).forEach(id => {
                    if (!pessoasAtuais.has(id)) {
                        map.removeLayer(marcadores[id]);
                        delete marcadores[id];
                    }
                });

            })
            .catch(error => {
                console.error("Erro ao buscar dados da API:", error);
            });

    }

    async function atualizarUsuariosAtivos() {
        try {
            const response = await fetch("https://api-checkin-7zte.onrender.com/usuarios_ativos");
            const data = await response.json();

            document.getElementById("qtd_user").innerHTML = data.total_ativos;
        } catch (error) {
            console.error("Erro ao buscar usuários ativos:", error);
        }
    }

    plotarPessoasNoMapa();
    atualizarUsuariosAtivos();

    setInterval(() => {
        plotarPessoasNoMapa();
        atualizarUsuariosAtivos();
    }, 10000);

});
