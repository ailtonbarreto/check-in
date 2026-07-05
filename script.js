let map;

document.addEventListener("DOMContentLoaded", function () {

    sessionStorage.clear();

    const btn_enviar = document.getElementById("btn_enviar");
    btn_enviar.style.display = "none";
    btn_enviar.addEventListener("click", enviarCoordenadas);

    Start();

});

function mostrarLocalizacao() {
    document.getElementById("spinner").style.display = "block";

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(iniciarMapa, mostrarErro);
    } else {
        alert("Geolocalização não é suportada por este navegador.");
        document.getElementById("spinner").style.display = "none";
    }
}

function Start() {
    const btn_start = document.getElementById("start-btn");
    const imagem = document.querySelector(".imagem");
    const nome = document.getElementById("nome");
    const modal = document.querySelector(".modal");
    const container = document.querySelector(".container");
    const saudacao = document.getElementById("saudacao");

    btn_start.addEventListener("click", function () {

        if (nome.value.trim() === "") {
            alert("Preencha seu nome");
            return;
        }

        imagem.style.display = "none";
        modal.style.display = "none";
        container.style.display = "flex";

        sessionStorage.setItem("nome", nome.value);
        saudacao.innerHTML = `Bem Vindo! <br> ${nome.value}`;

        mostrarLocalizacao();

    });
}

function iniciarMapa(posicao) {

    const latitude = posicao.coords.latitude;
    const longitude = posicao.coords.longitude;

    if (!map) {
        map = L.map("map").setView([latitude, longitude], 13);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);

    } else {
        map.setView([latitude, longitude], 13);
    }

    L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup(`
            <strong>${sessionStorage.getItem("nome")}</strong>
        `)
        .openPopup();

    document.getElementById("spinner").style.display = "none";
    document.getElementById("btn_enviar").style.display = "block";

    document.getElementById("btn_enviar").setAttribute("data-lat", latitude);
    document.getElementById("btn_enviar").setAttribute("data-lng", longitude);
}

function mostrarErro(erro) {

    let mensagem = "Erro desconhecido.";

    switch (erro.code) {
        case erro.PERMISSION_DENIED:
            mensagem = "Usuário negou a solicitação de geolocalização.";
            break;

        case erro.POSITION_UNAVAILABLE:
            mensagem = "Informações de localização indisponíveis.";
            break;

        case erro.TIMEOUT:
            mensagem = "A solicitação de geolocalização excedeu o tempo limite.";
            break;
    }

    alert(mensagem);
    document.getElementById("spinner").style.display = "none";
}

function enviarCoordenadas() {

    const btn = document.getElementById("btn_enviar");

    const latitude = btn.getAttribute("data-lat");
    const longitude = btn.getAttribute("data-lng");
    const nome = sessionStorage.getItem("nome");

    if (!latitude || !longitude) {
        alert("Coordenadas não disponíveis.");
        return;
    }

    const dados = {
        pessoa: nome,
        lat: latitude,
        lon: longitude
    };

    document.getElementById("spinner").style.display = "block";

    fetch("https://api-amigos-pelo-mundo.onrender.com/input", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(dados)
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById("spinner").style.display = "none";
        window.location.href = "./sucess.html";
    })
    .catch(error => {
        document.getElementById("spinner").style.display = "none";
        console.error("Erro:", error);
        alert("Erro ao enviar as coordenadas.");
    });
}