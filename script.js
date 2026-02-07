let map;

document.addEventListener("DOMContentLoaded", () => {
    const btnEnviar = document.getElementById("btn_enviar");
    btnEnviar.style.display = "none";
    btnEnviar.addEventListener("click", enviarCoordenadas);

    configurarStart();
});


// ================== START ==================
function configurarStart() {
    const btnStart = document.getElementById("start-btn");
    const nomeInput = document.getElementById("nome");

    btnStart.addEventListener("click", () => {
        if (!nomeInput.value.trim()) {
            alert("Informe seu nome");
            return;
        }

        sessionStorage.setItem("nome", nomeInput.value);

        document.querySelector(".modal").style.display = "none";
        document.querySelector(".container").style.display = "flex";

        document.getElementById("saudacao").innerHTML =
            `Bem-vindo<br>${nomeInput.value}`;

        mostrarLocalizacao();
    });
}


// ================== GEOLOCALIZAÇÃO ==================
function mostrarLocalizacao() {
    document.getElementById("spinner").style.display = "block";

    navigator.geolocation.getCurrentPosition(
        iniciarMapa,
        erroGeo
    );
}

function iniciarMapa(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    if (!map) {
        map = L.map("map").setView([lat, lon], 13);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png")
            .addTo(map);
    } else {
        map.setView([lat, lon], 13);
    }

    const nome = sessionStorage.getItem("nome");

    L.marker([lat, lon]).addTo(map)
        .bindPopup(`<strong>${nome}</strong>`)
        .openPopup();

    const btn = document.getElementById("btn_enviar");
    btn.style.display = "block";
    btn.dataset.lat = lat;
    btn.dataset.lon = lon;

    document.getElementById("spinner").style.display = "none";
}

function erroGeo() {
    alert("Erro ao obter localização");
    document.getElementById("spinner").style.display = "none";
}


function enviarCoordenadas() {
    const btn = document.getElementById("btn_enviar");

    const pessoa = sessionStorage.getItem("nome");
    const lat = btn.dataset.lat;
    const lon = btn.dataset.lon;

    if (!pessoa || !lat || !lon) {
        alert("Dados incompletos");
        return;
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://script.google.com/macros/s/AKfycbxvIjZe1A_PLB1vX688OO8aSEHL9hHcuQhnPCuNYzZGjTdGfV6dtyB9QaZ7s2RFy2hcZA/exec";

    const dados = {
        id: Date.now(),
        pessoa,
        lat,
        lon
    };

    for (const k in dados) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = dados[k];
        form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
}
