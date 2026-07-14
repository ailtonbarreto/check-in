// let map;
// let marcadores = {};

// document.addEventListener("DOMContentLoaded", function () {

//     sessionStorage.clear();

//     const spinner = document.getElementById("spinner");

//     function plotarPessoasNoMapa() {

//         if (spinner) spinner.style.display = "block";

//         fetch("https://api-amigos-pelo-mundo.onrender.com/localizacoes")
//             .then(response => response.json())
//             .then(response => {

//                 const pessoas = response.data;

//                 if (!pessoas || pessoas.length === 0) return;

//                 // Cria o mapa apenas uma vez
//                 if (!map) {

//                     map = L.map("map").setView([pessoas[0].lat, pessoas[0].lon], 2.5);

//                     L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
//                         attribution: "&copy; OpenStreetMap contributors"
//                     }).addTo(map);
//                 }

//                 // Guarda quem veio da API
//                 const pessoasAtuais = new Set();

//                 pessoas.forEach(pessoa => {

//                     const id = pessoa.pessoa; // ou pessoa.id se existir

//                     pessoasAtuais.add(id);
                    
//                     if (marcadores[id]) {

//                         marcadores[id].setLatLng([pessoa.lat, pessoa.lon]);

//                     } else {

//                         marcadores[id] = L.marker([pessoa.lat, pessoa.lon])
//                             .bindTooltip(
//                                 `<strong>${pessoa.pessoa}</strong>`,
//                                 {
//                                     permanent: true,
//                                     direction: "top",
//                                     offset: [0, -10]
//                                 }
//                             )
//                             .addTo(map);
//                     }

//                 });

//                 Object.keys(marcadores).forEach(id => {

//                     if (!pessoasAtuais.has(id)) {
//                         map.removeLayer(marcadores[id]);
//                         delete marcadores[id];
//                     }

//                 });

//             })
//             .catch(error => {
//                 console.error("Erro ao buscar dados da API:", error);
//             })
//             .finally(() => {
//                 if (spinner) spinner.style.display = "none";
//             });

//     }

//     plotarPessoasNoMapa();

//     setInterval(plotarPessoasNoMapa, 10000);

// });





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

        fetch("https://api-amigos-pelo-mundo.onrender.com/localizacoes")
            .then(response => response.json())
            .then(response => {

                const pessoas = response.data;
                if (!pessoas || pessoas.length === 0) return;

                if (!map) {
                    map = L.map("map").setView([pessoas[0].lat, pessoas[0].lon], 12);
                    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                        attribution: "&copy; OpenStreetMap contributors"
                    }).addTo(map);
                }

                const agora = new Date();
                console.log("AGORA (navegador):", agora.toISOString());

                const pessoasAtuais = new Set();

                pessoas.forEach(pessoa => {

                    const id = pessoa.pessoa;
                    pessoasAtuais.add(id);

                    // HORÁRIO ORIGINAL DO BANCO (UTC)
                    console.log("--------------------------------------------------");
                    console.log("Pessoa:", id);
                    console.log("Horário recebido do banco (UTC):", pessoa.data);

                    let dataRegistro = new Date(pessoa.data);

                    // CONVERTE UTC → BRT (UTC-3)
                    dataRegistro = new Date(dataRegistro.getTime() + (3 * 60 * 60 * 1000));

                    console.log("Horário convertido para BRT:", dataRegistro.toISOString());

                    // CALCULA DIFERENÇA
                    let diffSegundos = (agora - dataRegistro) / 1000;

                    console.log("Diferença em segundos:", diffSegundos);

                    if (diffSegundos < 0) {
                        console.log("Horário veio no futuro → corrigindo para 0");
                        diffSegundos = 0;
                    }

                    // Verde até 120s
                    const icon = diffSegundos > 120 ? iconLaranja() : iconVerde();

                    console.log("Cor escolhida:", diffSegundos > 120 ? "LARANJA" : "VERDE");

                    // REMOVE E RECRIA O MARCADOR
                    if (marcadores[id]) {
                        map.removeLayer(marcadores[id]);
                    }

                    marcadores[id] = L.marker([pessoa.lat, pessoa.lon], { icon })
                        .bindTooltip(
                            `<strong>${pessoa.pessoa}</strong>`,
                            {
                                permanent: true,
                                direction: "top",
                                offset: [0, -10]
                            }
                        )
                        .addTo(map);

                });

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

    plotarPessoasNoMapa();
    setInterval(plotarPessoasNoMapa, 10000);

});
