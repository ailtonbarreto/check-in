let map;

document.addEventListener("DOMContentLoaded", function () {

    sessionStorage.clear();

    const spinner = document.getElementById("spinner");

    function plotarPessoasNoMapa() {

        if (spinner) spinner.style.display = "block";

        fetch("https://api-amigos-pelo-mundo.onrender.com/localizacoes")
            .then(response => response.json())
            .then(response => {

                const pessoas = response.data;

                if (!pessoas || pessoas.length === 0) {
                    alert("Nenhuma localização encontrada.");
                    return;
                }

                if (!map) {
                    map = L.map("map").setView([pessoas[0].lat, pessoas[0].lon], 2.5);

                    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                        attribution: "&copy; OpenStreetMap contributors"
                    }).addTo(map);
                }


                pessoas.forEach(pessoa => {

                    L.marker([pessoa.lat, pessoa.lon])
                        .addTo(map)
                        .bindTooltip(
                            `<strong>${pessoa.pessoa}</strong>`,
                            {
                                permanent: true,
                                direction: "top",
                                offset: [0, -10]
                            }
                        );

                });

            })
            .catch(error => {
                console.error("Erro ao buscar dados da API:", error);
                alert("Houve um erro ao carregar as informações.");
            })
            .finally(() => {
                if (spinner) spinner.style.display = "none";
            });

    }

    plotarPessoasNoMapa();

});