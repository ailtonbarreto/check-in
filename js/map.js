let map;
let marcadores = {};

document.addEventListener("DOMContentLoaded", function () {

    sessionStorage.clear();

    const spinner = document.getElementById("spinner");

    function plotarPessoasNoMapa() {

        if (spinner) spinner.style.display = "block";

        fetch("https://api-amigos-pelo-mundo.onrender.com/localizacoes")
            .then(response => response.json())
            .then(response => {

                const pessoas = response.data;

                if (!pessoas || pessoas.length === 0) return;

                // Cria o mapa apenas uma vez
                if (!map) {

                    map = L.map("map").setView([pessoas[0].lat, pessoas[0].lon], 2.5);

                    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                        attribution: "&copy; OpenStreetMap contributors"
                    }).addTo(map);
                }

                // Guarda quem veio da API
                const pessoasAtuais = new Set();

                pessoas.forEach(pessoa => {

                    const id = pessoa.pessoa; // ou pessoa.id se existir

                    pessoasAtuais.add(id);
                    
                    if (marcadores[id]) {

                        marcadores[id].setLatLng([pessoa.lat, pessoa.lon]);

                    } else {

                        marcadores[id] = L.marker([pessoa.lat, pessoa.lon])
                            .bindTooltip(
                                `<strong>${pessoa.pessoa}</strong>`,
                                {
                                    permanent: true,
                                    direction: "top",
                                    offset: [0, -10]
                                }
                            )
                            .addTo(map);
                    }

                });

                Object.keys(marcadores).forEach(id => {

                    if (!pessoasAtuais.has(id)) {
                        map.removeLayer(marcadores[id]);
                        delete marcadores[id];
                    }

                });

            })
            .catch(error => {
                console.error("Erro ao buscar dados da API:", error);
            })
            .finally(() => {
                if (spinner) spinner.style.display = "none";
            });

    }

    plotarPessoasNoMapa();

    setInterval(plotarPessoasNoMapa, 10000);

});