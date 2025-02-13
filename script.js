let map;

document.addEventListener("DOMContentLoaded", function() {
    const btn_enviar = document.getElementById("btn_enviar");
    
    
    btn_enviar.style.display = "none";

    btn_enviar.addEventListener("click", enviarCoordenadas);

    Start()
});

function mostrarLocalizacao() {
    document.getElementById("spinner").style.display = "block";
    

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(iniciarMapa, mostrarErro);
    } else {
        alert("Geolocalização não é suportada por este navegador.");
    }

}


function Start(){
    const btn_start = document.getElementById("start-btn");
    const imagem = document.querySelector(".imagem");
    const nome = document.getElementById("nome");

    const modal = document.querySelector(".modal");
    const container = document.querySelector(".container");
    const saudacao = document.getElementById("saudacao");

    btn_start.addEventListener("click", function(){

        if(nome.value.trim() === ""){

            alert("Preencha seu nome");

        }else{
            imagem.style.display = "none";
            modal.style.display = "none";
            container.style.display = "flex";
            sessionStorage.setItem("nome",nome.value)
            saudacao.innerHTML = `Bem Vindo! <br> ${nome.value}`
            mostrarLocalizacao();

        };

    });

}


function iniciarMapa(posicao) {
    let latitude = posicao.coords.latitude;
    let longitude = posicao.coords.longitude;



    if (!map) {
        map = L.map('map').setView([latitude, longitude], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            // attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
    } else {
        map.setView([latitude, longitude], 13);
    }
    

    const imagem = sessionStorage.getItem("foto_base64");

    L.marker([latitude, longitude]).addTo(map)
        // .bindPopup(`<b>Você está aqui!</b>`)
        .bindPopup(`<img src="${imagem}" width="100" alt="Mapa">`)
        .openPopup();

    document.getElementById("spinner").style.display = "none";

    document.getElementById("btn_enviar").style.display = "block";


    console.log(latitude,longitude);

    document.getElementById("btn_enviar").setAttribute("data-lat", latitude);
    document.getElementById("btn_enviar").setAttribute("data-lng", longitude);
}

function mostrarErro(erro) {
    switch (erro.code) {
        case erro.PERMISSION_DENIED:
            alert("Usuário negou a solicitação de geolocalização.");
            break;
        case erro.POSITION_UNAVAILABLE:
            alert("Informações de localização indisponíveis.");
            break;
        case erro.TIMEOUT:
            alert("A solicitação de geolocalização excedeu o tempo limite.");
            break;
        case erro.UNKNOWN_ERROR:
            alert("Erro desconhecido.");
            break;
    }

    document.getElementById("spinner").style.display = "none";
}
// ---------------------------------------------------------------------------------------------
function enviarCoordenadas() {
    const btn = document.getElementById("btn_enviar");
    const latitude = btn.getAttribute("data-lat");
    const longitude = btn.getAttribute("data-lng");
    const nome = sessionStorage.getItem("nome");
    const foto = sessionStorage.getItem("foto_base64");  // Pegando a foto no formato base64

    if (!latitude || !longitude) {
        alert("Coordenadas não disponíveis.");
        return;
    }

    if (!foto) {
        alert("Foto não disponível.");
        return;
    }

    const dados = {
        pessoa: nome,
        lat: latitude,
        lon: longitude,
        foto: foto  // Adicionando a foto no corpo da requisição
    };

    fetch("https://api-localizacao-e69z.onrender.com/input", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(dados)
    })
    .then(response => response.json())
    .then(data => {
        alert("Localização e foto enviadas com sucesso!");
    })
    .catch(error => {
        alert("Erro ao enviar localização e foto.");
        console.error("Erro:", error);
    });
}
