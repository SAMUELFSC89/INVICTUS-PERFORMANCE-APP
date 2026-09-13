import Foundation

// Os LiveActivityIntent usados pelos botões da Live Activity foram movidos
// para App/InvictusActivityAttributes.swift. Esse arquivo já é compilado nos
// dois targets (App + InvictusActivityWidget), que é o requisito para que o
// sistema execute o intent no processo do app host e o widget consiga referir
// os mesmos tipos. Mantemos este source vazio porque o projeto Xcode legado
// ainda o referencia explicitamente no target da extensão.
