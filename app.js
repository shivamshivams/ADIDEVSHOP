import { 
    auth, db, googleProvider,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup,
    collection, doc, setDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, onSnapshot
} from "./firebase.js";

const AppState = {
    currentUser: null,
    isAdmin: false,
    products: [],
    cart: [],
    wishlist: [],
    currentCategory: "all",
    currentSort: "default",
    adminTargetUid: "pZ16DY2C8cV2P4S4wd7Z4B6qBKH3"
};

document.addEventListener("DOMContentLoaded", () => {
    initAppEcosystem();
    bindUserInterfaceEvents();
});

function initAppEcosystem() {
    onAuthStateChanged(auth, async (user) => {
        showGlobalLoader(true);
        if (user) {
            AppState.currentUser = user;
            if (user.uid === AppState.adminTargetUid) {
                AppState.isAdmin = true;
                setupAdminEnvironment();
            } else {
                AppState.isAdmin = false;
                await setupUserEnvironment();
            }
        } else {
            teardownEnvironments();
            showLayout("auth-layout");
        }
        showGlobalLoader(false);
    });

    document.addEventListener('navToHome', () => switchUserView('home'));
}

function setupAdminEnvironment() {
    showLayout("admin-layout");
    initAdminNavigation();
    syncAdminDashboardMetrics();
    streamAdminProductCluster();
    streamAdminOrderLogs();
    showToast("Elevated Root Admin Access Enabled.");
}

async function setupUserEnvironment() {
    showLayout("user-layout");
    switchUserView("home");
    initUserNavigation();
    streamStorefrontCatalog();
    syncUserCartAndWishlist();
}

function teardownEnvironments() {
    AppState.currentUser = null;
    AppState.isAdmin = false;
    AppState.products = [];
    AppState.cart = [];
    AppState.wishlist = [];
}

function bindUserInterfaceEvents() {
    document.getElementById("tab-login").addEventListener("click", () => toggleAuthTabs("login"));
    document.getElementById("tab-signup").addEventListener("click", () => toggleAuthTabs("signup"));
    document.getElementById("login-form").addEventListener("submit", handleEmailLogin);
    document.getElementById("signup-form").addEventListener("submit", handleEmailSignup);
    document.getElementById("google-signin-btn").addEventListener("click", handleGoogleAuthentication);
    document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));
    document.getElementById("admin-logout-btn").addEventListener("click", () => signOut(auth));

    document.getElementById("search-toggle-btn").addEventListener("click", () => {
        document.getElementById("search-expandable").classList.toggle("hidden");
    });
    document.getElementById("global-search-input").addEventListener("input", throttleSearchQuery);
    document.getElementById("filter-sort-select").addEventListener("change", (e) => {
        AppState.currentSort = e.target.value;
        renderCatalogGrid("explore-product-grid", filterAndSortCollection());
    });

    document.getElementById("admin-product-form").addEventListener("submit", handleProductFormCommit);
    document.getElementById("checkout-proc-btn").addEventListener("click", handleSecureOrderPlacement);
}

function showLayout(layoutId) {
    document.getElementById("user-layout").classList.add("hidden");
    document.getElementById("auth-layout").classList.add("hidden");
    document.getElementById("admin-layout").classList.add("hidden");
    document.getElementById(layoutId).classList.remove("hidden");
}

function switchUserView(viewTarget) {
    document.querySelectorAll(".app-view").forEach(v => v.classList.add("hidden"));
    document.getElementById(`view-${viewTarget}`).classList.remove("hidden");
    document.querySelectorAll(".bottom-nav .nav-item").forEach(item => {
        if(item.getAttribute("data-target") === viewTarget) item.classList.add("active");
        else item.classList.remove("active");
    });
    if(viewTarget === 'cart') renderCartItemsView();
    if(viewTarget === 'wishlist') renderWishlistItemsView();
    if(viewTarget === 'profile') renderUserProfileAndOrders();
    if(viewTarget === 'categories') renderCatalogGrid("explore-product-grid", AppState.products);
}

function initUserNavigation() {
    document.querySelectorAll(".bottom-nav .nav-item").forEach(btn => {
        const freshBtn = btn.cloneNode(true);
        btn.replaceWith(freshBtn);
        freshBtn.addEventListener("click", () => switchUserView(freshBtn.getAttribute("data-target")));
    });

    document.querySelectorAll("#category-list-container .category-pill").forEach(pill => {
        pill.addEventListener("click", (e) => {
            document.querySelectorAll("#category-list-container .category-pill").forEach(p => p.classList.remove("active"));
            e.target.classList.add("active");
            AppState.currentCategory = e.target.getAttribute("data-category");
            if(AppState.currentCategory !== "all") {
                switchUserView("categories");
                renderCatalogGrid("explore-product-grid", filterAndSortCollection());
            } else {
                switchUserView("home");
            }
        });
    });
}

async function handleEmailLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const pass = document.getElementById("login-password").value;
    try {
        showGlobalLoader(true);
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        showToast(err.message);
        showGlobalLoader(false);
    }
}

async function handleEmailSignup(e) {
    e.preventDefault();
    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const pass = document.getElementById("signup-password").value;
    try {
        showGlobalLoader(true);
        const credentials = await createUserWithEmailAndPassword(auth, email, pass);
        await setDoc(doc(db, "users", credentials.user.uid), {
            uid: credentials.user.uid, displayName: name, email: email, role: "customer", createdAt: new Date().toISOString()
        });
    } catch (err) {
        showToast(err.message);
        showGlobalLoader(false);
    }
}

async function handleGoogleAuthentication() {
    try {
        showGlobalLoader(true);
        const target = await signInWithPopup(auth, googleProvider);
        await setDoc(doc(db, "users", target.user.uid), {
            uid: target.user.uid, displayName: target.user.displayName || "Client Account", email: target.user.email, role: target.user.uid === AppState.adminTargetUid ? "admin" : "customer", lastLogin: new Date().toISOString()
        }, { merge: true });
    } catch (err) {
        showToast(err.message);
        showGlobalLoader(false);
    }
}

function toggleAuthTabs(mode) {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    if (mode === "login") {
        document.getElementById("tab-login").classList.add("active");
        document.getElementById("login-form").classList.remove("hidden");
        document.getElementById("signup-form").classList.add("hidden");
    } else {
        document.getElementById("tab-signup").classList.add("active");
        document.getElementById("signup-form").classList.remove("hidden");
        document.getElementById("login-form").classList.add("hidden");
    }
}

function streamStorefrontCatalog() {
    onSnapshot(collection(db, "products"), (snapshot) => {
        AppState.products = [];
        snapshot.forEach(doc => AppState.products.push({ id: doc.id, ...doc.data() }));
        renderCatalogGrid("home-product-grid", AppState.products.slice(0, 4));
    });
}

function filterAndSortCollection() {
    let dataset = [...AppState.products];
    if (AppState.currentCategory !== "all") dataset = dataset.filter(p => p.category === AppState.currentCategory);
    if (AppState.currentSort === "low-high") dataset.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    if (AppState.currentSort === "high-low") dataset.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    return dataset;
}

function renderCatalogGrid(elementId, items) {
    const grid = document.getElementById(elementId);
    grid.innerHTML = "";
    if(items.length === 0) {
        grid.innerHTML = `<div style="padding:20px; font-size:0.85rem; color:var(--text-muted)">No items cataloged.</div>`;
        return;
    }
    items.forEach(item => {
        const card = document.createElement("div");
        card.className = "product-card";
        const isFav = AppState.wishlist.some(w => w.id === item.id);
        card.innerHTML = `
            <div class="prod-image-wrap">
                <img src="${item.image}" alt="" loading="lazy">
                <button class="fav-toggle-btn ${isFav ? 'active' : ''}"><span class="material-icons-round">favorite</span></button>
            </div>
            <div class="prod-details">
                <h4>${item.name}</h4>
                <span class="price">$${parseFloat(item.price).toFixed(2)}</span>
            </div>
        `;
        card.querySelector("img").addEventListener("click", () => renderProductDetailView(item));
        card.querySelector(".fav-toggle-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            toggleWishlistItem(item);
        });
        grid.appendChild(card);
    });
}

function renderProductDetailView(item) {
    switchUserView("product-detail");
    const container = document.getElementById("product-detail-render");
    container.innerHTML = `
        <div class="detail-img-box"><img src="${item.image}" alt=""></div>
        <div class="detail-meta">
            <h2>${item.name}</h2>
            <div class="detail-price">$${parseFloat(item.price).toFixed(2)}</div>
            <p>${item.description || "Premium bespoke item styled for daily comfort."}</p>
            <div class="input-group">
                <label>Size Matrix</label>
                <select id="detail-size-select">${(item.sizes || ['S','M','L']).map(s => `<option value="${s}">${s}</option>`).join('')}</select>
            </div>
            <button id="add-to-bag-btn" class="btn btn-primary btn-block"><span class="material-icons-round">shopping_bag</span> Add to Bag</button>
        </div>
    `;
    document.getElementById("add-to-bag-btn").addEventListener("click", () => {
        addItemToUserCart(item, document.getElementById("detail-size-select").value);
    });
}

function throttleSearchQuery(e) {
    const text = e.target.value.toLowerCase().trim();
    if(text === "") { renderCatalogGrid("explore-product-grid", AppState.products); return; }
    const matching = AppState.products.filter(p => p.name.toLowerCase().includes(text));
    switchUserView("categories");
    renderCatalogGrid("explore-product-grid", matching);
}

function syncUserCartAndWishlist() {
    onSnapshot(doc(db, "users", AppState.currentUser.uid), (snap) => {
        if(snap.exists()) {
            const data = snap.data();
            AppState.cart = data.cart || [];
            AppState.wishlist = data.wishlist || [];
            updateNavigationCounterBadges();
        }
    });
}

async function addItemToUserCart(item, size) {
    const idx = AppState.cart.findIndex(c => c.id === item.id && c.size === size);
    if(idx > -1) AppState.cart[idx].quantity += 1;
    else AppState.cart.push({ id: item.id, name: item.name, price: item.price, image: item.image, size: size, quantity: 1 });
    await commitUserShoppingMetaCluster();
    showToast("Added to bag.");
}

async function updateCartItemQty(id, size, factor) {
    const idx = AppState.cart.findIndex(c => c.id === id && c.size === size);
    if(idx === -1) return;
    AppState.cart[idx].quantity += factor;
    if(AppState.cart[idx].quantity <= 0) AppState.cart.splice(idx, 1);
    await commitUserShoppingMetaCluster();
    renderCartItemsView();
}

async function toggleWishlistItem(item) {
    const idx = AppState.wishlist.findIndex(w => w.id === item.id);
    if (idx > -1) AppState.wishlist.splice(idx, 1);
    else AppState.wishlist.push({id: item.id, name: item.name, price: item.price, image: item.image});
    await commitUserShoppingMetaCluster();
    showToast("Wishlist synchronized.");
}

async function commitUserShoppingMetaCluster() {
    await setDoc(doc(db, "users", AppState.currentUser.uid), { cart: AppState.cart, wishlist: AppState.wishlist }, { merge: true });
}

function updateNavigationCounterBadges() {
    const badge = document.getElementById("badge-cart-count");
    const count = AppState.cart.reduce((acc, c) => acc + c.quantity, 0);
    if(count > 0) { badge.innerText = count; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
}

function renderCartItemsView() {
    const target = document.getElementById("cart-items-container");
    const summary = document.getElementById("cart-summary-card");
    target.innerHTML = "";
    if(AppState.cart.length === 0) { target.innerHTML = `<div style="padding:20px; font-size:0.85rem; color:var(--text-muted)">Bag is empty.</div>`; summary.classList.add("hidden"); return; }
    summary.classList.remove("hidden");
    let subtotal = 0;
    AppState.cart.forEach(item => {
        subtotal += (parseFloat(item.price) * item.quantity);
        const el = document.createElement("div");
        el.className = "cart-item";
        el.innerHTML = `
            <img src="${item.image}" alt="" class="cart-item-img">
            <div class="cart-item-info">
                <h4>${item.name}</h4>
                <p>Size: ${item.size} | $${parseFloat(item.price).toFixed(2)}</p>
                <div class="cart-qty-ctrl">
                    <button class="qty-btn dec-qty">-</button>
                    <span>${item.quantity}</span>
                    <button class="qty-btn inc-qty">+</button>
                </div>
            </div>
        `;
        el.querySelector(".dec-qty").addEventListener("click", () => updateCartItemQty(item.id, item.size, -1));
        el.querySelector(".inc-qty").addEventListener("click", () => updateCartItemQty(item.id, item.size, 1));
        target.appendChild(el);
    });
    document.getElementById("cart-subtotal").innerText = `$${subtotal.toFixed(2)}`;
    document.getElementById("cart-total").innerText = `$${subtotal.toFixed(2)}`;
}

function renderWishlistItemsView() { renderCatalogGrid("wishlist-product-grid", AppState.wishlist); }

async function handleSecureOrderPlacement() {
    if(AppState.cart.length === 0) return;
    try {
        showGlobalLoader(true);
        const totalAmount = AppState.cart.reduce((acc, c) => acc + (parseFloat(c.price) * c.quantity), 0);
        await addDoc(collection(db, "orders"), {
            userId: AppState.currentUser.uid, userEmail: AppState.currentUser.email, items: AppState.cart, amount: totalAmount, status: "pending", timestamp: new Date().toISOString()
        });
        AppState.cart = [];
        await commitUserShoppingMetaCluster();
        showToast("Order placed successfully.");
        switchUserView("profile");
    } catch(err) {
        showToast(err.message);
    } finally {
        showGlobalLoader(false);
    }
}

async function renderUserProfileAndOrders() {
    document.getElementById("profile-display-name").innerText = AppState.currentUser.displayName || "Customer Account";
    document.getElementById("profile-display-email").innerText = AppState.currentUser.email;
    const wrapper = document.getElementById("order-history-list");
    wrapper.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "orders"), where("userId", "==", AppState.currentUser.uid)));
    if(snaps.empty) { wrapper.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted)">No prior orders found.</p>`; return; }
    snaps.forEach(doc => {
        const order = doc.data();
        const card = document.createElement("div");
        card.className = "order-card";
        card.innerHTML = `
            <div class="order-card-header"><span>ID: #${doc.id.substring(0,6).toUpperCase()}</span><span class="status-chip ${order.status}">${order.status}</span></div>
            <div style="font-size:0.85rem; font-weight:700;">Total: $${parseFloat(order.amount).toFixed(2)}</div>
        `;
        wrapper.appendChild(card);
    });
}

function initAdminNavigation() {
    document.querySelectorAll(".admin-sidebar .admin-nav-item").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".admin-sidebar .admin-nav-item").forEach(i => i.classList.remove("active"));
            e.currentTarget.classList.add("active");
            document.querySelectorAll(".admin-view").forEach(v => v.classList.add("hidden"));
            document.getElementById(e.currentTarget.getAttribute("data-target")).classList.remove("hidden");
        });
    });
}

async function syncAdminDashboardMetrics() {
    const prods = await getDocs(collection(db, "products"));
    const users = await getDocs(collection(db, "users"));
    const ords = await getDocs(collection(db, "orders"));
    let totalRevenue = 0;
    ords.forEach(o => { if(o.data().status !== 'cancelled') totalRevenue += parseFloat(o.data().amount || 0); });
    document.getElementById("stat-revenue").innerText = `$${totalRevenue.toFixed(2)}`;
    document.getElementById("stat-users").innerText = users.size;
    document.getElementById("stat-products").innerText = prods.size;
    document.getElementById("stat-orders").innerText = ords.size;
}

function streamAdminProductCluster() {
    onSnapshot(collection(db, "products"), (snap) => {
        const container = document.getElementById("admin-product-list-container");
        container.innerHTML = "";
        snap.forEach(docRef => {
            const prod = docRef.data();
            const row = document.createElement("div");
            row.className = "admin-prod-row";
            row.innerHTML = `
                <img src="${prod.image}" alt="">
                <div><h5>${prod.name}</h5><span>$${parseFloat(prod.price).toFixed(2)}</span></div>
                <div class="admin-row-actions">
                    <button class="icon-btn edit-btn" data-id="${docRef.id}"><span class="material-icons-round" style="font-size:16px">edit</span></button>
                    <button class="icon-btn del-btn" data-id="${docRef.id}"><span class="material-icons-round" style="font-size:16px; color:#e63946">delete</span></button>
                </div>
            `;
            row.querySelector(".edit-btn").addEventListener("click", () => populateProductFormForEdit(docRef.id, prod));
            row.querySelector(".del-btn").addEventListener("click", () => handleProductDeletion(docRef.id));
            container.appendChild(row);
        });
    });
}

async function handleProductFormCommit(e) {
    e.preventDefault();
    if(auth.currentUser.uid !== AppState.adminTargetUid) return;
    const id = document.getElementById("edit-prod-id").value;
    const payload = {
        name: document.getElementById("prod-name").value.trim(),
        price: parseFloat(document.getElementById("prod-price").value),
        category: document.getElementById("prod-category").value,
        image: document.getElementById("prod-image").value.trim(),
        description: document.getElementById("prod-desc").value.trim()
    };
    try {
        showGlobalLoader(true);
        if(id) await updateDoc(doc(db, "products", id), payload);
        else await addDoc(collection(db, "products"), payload);
        document.getElementById("admin-product-form").reset();
        document.getElementById("edit-prod-id").value = "";
        document.getElementById("prod-submit-btn").innerText = "Save to Cluster";
        syncAdminDashboardMetrics();
    } catch(err) { showToast(err.message); }
    finally { showGlobalLoader(false); }
}

function populateProductFormForEdit(id, prod) {
    document.getElementById("edit-prod-id").value = id;
    document.getElementById("prod-name").value = prod.name;
    document.getElementById("prod-price").value = prod.price;
    document.getElementById("prod-category").value = prod.category;
    document.getElementById("prod-image").value = prod.image;
    document.getElementById("prod-desc").value = prod.description || "";
    document.getElementById("prod-submit-btn").innerText = "Update Product Object";
}

async function handleProductDeletion(id) {
    if(!confirm("Delete this catalog item object data string permanently?")) return;
    try {
        showGlobalLoader(true);
        await deleteDoc(doc(db, "products", id));
        syncAdminDashboardMetrics();
    } catch(err) { showToast(err.message); }
    finally { showGlobalLoader(false); }
}

function streamAdminOrderLogs() {
    onSnapshot(collection(db, "orders"), (snap) => {
        const recentRows = document.getElementById("admin-recent-orders-rows");
        const globalRows = document.getElementById("admin-global-orders-rows");
        recentRows.innerHTML = ""; globalRows.innerHTML = "";
        snap.forEach(docRef => {
            const order = docRef.data();
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>#${docRef.id.substring(0,6).toUpperCase()}</td><td>${order.userEmail}</td><td>$${parseFloat(order.amount).toFixed(2)}</td><td><span class="status-chip ${order.status}">${order.status}</span></td>`;
            recentRows.appendChild(tr.cloneNode(true));
            const actionTd = document.createElement("td");
            actionTd.innerHTML = `
                <select class="status-select" data-id="${docRef.id}">
                    <option value="pending" ${order.status === 'pending'?'selected':''}>Pending</option>
                    <option value="processing" ${order.status === 'processing'?'selected':''}>Processing</option>
                    <option value="delivered" ${order.status === 'delivered'?'selected':''}>Delivered</option>
                    <option value="cancelled" ${order.status === 'cancelled'?'selected':''}>Cancelled</option>
                </select>
            `;
            actionTd.querySelector(".status-select").addEventListener("change", (e) => {
                updateOrderStatusViaAdmin(e.target.getAttribute("data-id"), e.target.value);
            });
            const extendedTr = tr.cloneNode(true);
            extendedTr.appendChild(actionTd);
            globalRows.appendChild(extendedTr);
        });
    });
}

async function updateOrderStatusViaAdmin(orderId, nextStatus) {
    if(auth.currentUser.uid !== AppState.adminTargetUid) return;
    try {
        await updateDoc(doc(db, "orders", orderId), { status: nextStatus });
        syncAdminDashboardMetrics();
        showToast("Logistics state updated.");
    } catch(err) { showToast(err.message); }
}

function showGlobalLoader(status) {
    if(status) document.getElementById("app-loader").classList.remove("hidden");
    else document.getElementById("app-loader").classList.add("hidden");
}

function showToast(message) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}
