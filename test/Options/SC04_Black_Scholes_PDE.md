# SC-04: The Black-Scholes PDE
# From Stochastic Calculus to Partial Differential Equations

**Course Objective:** Derive the Black-Scholes partial differential equation from no-arbitrage arguments, understand the Feynman-Kac connection, solve for European options, and master the Greeks for risk management.

**Prerequisites:** SC-01 (Brownian Motion), SC-02 (Itô's Formula), SC-03 (CMG & Risk-Neutral Pricing)

---

## 1. Two Approaches to Option Pricing

### 1.1 The Duality

There are two equivalent ways to price derivatives in the Black-Scholes framework:

**Approach 1 - Probabilistic (SC-03):**
$$
V_t = e^{-r(T-t)} \mathbb{E}_{\mathbb{Q}}(f(S_T) | \mathcal{F}_t)
\tag{sc04.f.1.1}
$$

Take expectation under risk-neutral measure $\mathbb{Q}$.

**Approach 2 - PDE (This Chapter):**
$$
\frac{\partial V}{\partial t} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} + rS\frac{\partial V}{\partial S} - rV = 0
\tag{sc04.f.1.2}
$$

Solve partial differential equation with boundary condition $V(S,T) = f(S)$.

**The Feynman-Kac theorem** shows these are equivalent!

### 1.2 Why Study PDEs?

**Advantages of PDE approach:**
1. **Greeks computation:** Partial derivatives = risk sensitivities
2. **Numerical methods:** Finite difference schemes for complex payoffs
3. **American options:** Free boundary problems
4. **Intuition:** See how option value depends on parameters

**When to use each:**
- **Simple European options:** Closed-form via expectations (faster)
- **Path-dependent options:** Sometimes easier via PDEs
- **American options:** PDEs with free boundaries
- **Greeks:** PDE approach gives all sensitivities simultaneously

---

## 2. Derivation of Black-Scholes PDE

### 2.1 Setup and Assumptions

**Market model:**
- **Bond:** $B_t = e^{rt}$ (constant interest rate $r$)
- **Stock:** $dS_t = \mu S_t dt + \sigma S_t dW_t$ under $\mathbb{P}$

**Derivative:** European option with payoff $X = f(S_T)$ at maturity $T$.

**Key assumption:** Option value depends only on current stock price and time:
$$
V_t = V(S_t, t)
\tag{sc04.f.2.1}
$$

for some smooth function $V(S,t)$.

### 2.2 Method 1: Self-Financing Portfolio

**From SC-03:** Replicating strategy $(\phi_t, \psi_t)$ must be self-financing:
$$
dV_t = \phi_t dS_t + \psi_t dB_t
\tag{sc04.f.2.2}
$$

**Portfolio value:** $V_t = \phi_t S_t + \psi_t B_t$

**Step 1 - Apply Itô's formula to $V(S_t, t)$:**

Using sc02.f.3.3 with $dS_t = \mu S_t dt + \sigma S_t dW_t$:
$$
\begin{aligned}
dV_t &= \frac{\partial V}{\partial t} dt + \frac{\partial V}{\partial S} dS_t + \frac{1}{2}\frac{\partial^2 V}{\partial S^2} (dS_t)^2 \\
&= \frac{\partial V}{\partial t} dt + \frac{\partial V}{\partial S}(\mu S dt + \sigma S dW_t) + \frac{1}{2}\frac{\partial^2 V}{\partial S^2} \sigma^2 S^2 dt
\end{aligned}
\tag{sc04.f.2.3}
$$

Collecting terms:
$$
dV_t = \left[\frac{\partial V}{\partial t} + \mu S \frac{\partial V}{\partial S} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2}\right] dt + \sigma S \frac{\partial V}{\partial S} dW_t
\tag{sc04.f.2.4}
$$

**Step 2 - Self-financing condition:**

$$
dV_t = \phi_t dS_t + \psi_t dB_t = \phi_t(\mu S_t dt + \sigma S_t dW_t) + \psi_t r B_t dt
\tag{sc04.f.2.5}
$$

$$
= (\phi_t \sigma S_t) dW_t + (\mu S_t \phi_t + r\psi_t B_t) dt
\tag{sc04.f.2.6}
$$

**Step 3 - Match coefficients (SDE uniqueness):**

**Volatility terms:**
$$
\sigma S \frac{\partial V}{\partial S} = \phi_t \sigma S_t \implies \boxed{\phi_t = \frac{\partial V}{\partial S}}
\tag{sc04.f.2.7}
$$

**The Delta hedge!**

**Drift terms:**
$$
\frac{\partial V}{\partial t} + \mu S \frac{\partial V}{\partial S} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} = \mu S \phi_t + r\psi_t B_t
\tag{sc04.f.2.8}
$$

**Step 4 - Eliminate $\mu$ (no-arbitrage):**

From $V_t = \phi_t S_t + \psi_t B_t$ and $\phi_t = \frac{\partial V}{\partial S}$:
$$
\psi_t B_t = V_t - S_t \frac{\partial V}{\partial S}
\tag{sc04.f.2.9}
$$

Substitute into sc04.f.2.8:
$$
\frac{\partial V}{\partial t} + \mu S \frac{\partial V}{\partial S} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} = \mu S \frac{\partial V}{\partial S} + r\left(V - S\frac{\partial V}{\partial S}\right)
\tag{sc04.f.2.10}
$$

Cancel $\mu S \frac{\partial V}{\partial S}$ from both sides:
$$
\frac{\partial V}{\partial t} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} = rV - rS\frac{\partial V}{\partial S}
\tag{sc04.f.2.11}
$$

**Rearrange:**
$$
\boxed{\frac{\partial V}{\partial t} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} + rS\frac{\partial V}{\partial S} - rV = 0}
\tag{sc04.f.2.12}
$$

**This is the Black-Scholes PDE!**

**Remarkable:** The drift $\mu$ disappeared! The PDE depends only on $r, \sigma$, not on the stock's expected return.

### 2.3 Method 2: Risk-Neutral Pricing

**From SC-03:** Under risk-neutral measure $\mathbb{Q}$:
$$
dS_t = rS_t dt + \sigma S_t d\tilde{W}_t
\tag{sc04.f.2.13}
$$

where $\tilde{W}_t$ is $\mathbb{Q}$-Brownian motion.

**Price formula:**
$$
V(S,t) = e^{-r(T-t)} \mathbb{E}_{\mathbb{Q}}(f(S_T) | S_t = S)
\tag{sc04.f.2.14}
$$

**Apply Itô under $\mathbb{Q}$:** Replace $\mu$ with $r$ in sc04.f.2.4:
$$
dV_t = \left[\frac{\partial V}{\partial t} + rS \frac{\partial V}{\partial S} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2}\right] dt + \sigma S \frac{\partial V}{\partial S} d\tilde{W}_t
\tag{sc04.f.2.15}
$$

**Since $V_t$ discounted is a $\mathbb{Q}$-martingale:**
$$
d(e^{-rt} V_t) = e^{-rt} dV_t - re^{-rt} V_t dt \text{ must have zero drift}
\tag{sc04.f.2.16}
$$

**Compute:**
$$
\begin{aligned}
d(e^{-rt}V_t) &= e^{-rt}\left[\frac{\partial V}{\partial t} + rS\frac{\partial V}{\partial S} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} - rV\right] dt + \cdots dW_t
\end{aligned}
\tag{sc04.f.2.17}
$$

**For martingale property (zero drift):**
$$
\frac{\partial V}{\partial t} + rS\frac{\partial V}{\partial S} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} - rV = 0
\tag{sc04.f.2.18}
$$

**Same PDE!** ✓

---

## 3. The Feynman-Kac Theorem

### 3.1 General Statement

**Theorem 3.1 (Feynman-Kac):**

Let $X_t$ satisfy SDE:
$$
dX_t = \mu(X_t, t) dt + \sigma(X_t, t) dW_t
\tag{sc04.f.3.1}
$$

Define:
$$
u(x,t) = \mathbb{E}\left[e^{-\int_t^T r(X_s, s) ds} g(X_T) \bigg| X_t = x\right]
\tag{sc04.f.3.2}
$$

Then $u(x,t)$ satisfies the PDE:
$$
\frac{\partial u}{\partial t} + \mu(x,t)\frac{\partial u}{\partial x} + \frac{1}{2}\sigma^2(x,t)\frac{\partial^2 u}{\partial x^2} - r(x,t) u = 0
\tag{sc04.f.3.3}
$$

with terminal condition $u(x,T) = g(x)$.

**Conversely:** Solution to PDE equals the expectation!

### 3.2 Application to Black-Scholes

For Black-Scholes:
- $X_t = S_t$ (stock price)
- $\mu(S,t) = rS$ (risk-neutral drift)
- $\sigma(S,t) = \sigma S$ (volatility)
- $r(S,t) = r$ (constant discount rate)
- $g(S) = f(S)$ (payoff function)

**Feynman-Kac gives:**
$$
V(S,t) = \mathbb{E}_{\mathbb{Q}}[e^{-r(T-t)} f(S_T) | S_t = S]
\tag{sc04.f.3.4}
$$

satisfies:
$$
\frac{\partial V}{\partial t} + rS\frac{\partial V}{\partial S} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} - rV = 0
\tag{sc04.f.3.5}
$$

**This bridges probability and PDEs!**

---

## 4. Solving for European Call Option

### 4.1 The Problem

**Payoff:** $f(S) = \max(S - K, 0) = (S - K)^+$

**PDE:** sc04.f.2.12 with boundary condition $V(S,T) = (S-K)^+$

**Strategy:** Transform to heat equation using change of variables.

### 4.2 Change of Variables

**Transform 1 - Logarithmic price:**
$$
x = \log(S/K), \quad \tau = T - t
\tag{sc04.f.4.1}
$$

Let $V(S,t) = K u(x, \tau)$ where $\tau$ is time-to-maturity.

**Chain rule:**
$$
\begin{aligned}
\frac{\partial V}{\partial S} &= \frac{\partial u}{\partial x} \frac{1}{S} \\
\frac{\partial^2 V}{\partial S^2} &= \frac{1}{S^2}\left(\frac{\partial^2 u}{\partial x^2} - \frac{\partial u}{\partial x}\right) \\
\frac{\partial V}{\partial t} &= -K\frac{\partial u}{\partial \tau}
\end{aligned}
\tag{sc04.f.4.2}
$$

**Substitute into BS PDE:**
$$
-K\frac{\partial u}{\partial \tau} + \frac{1}{2}\sigma^2 K\left(\frac{\partial^2 u}{\partial x^2} - \frac{\partial u}{\partial x}\right) + rK\frac{\partial u}{\partial x} - rKu = 0
\tag{sc04.f.4.3}
$$

Divide by $K$:
$$
\frac{\partial u}{\partial \tau} = \frac{1}{2}\sigma^2 \frac{\partial^2 u}{\partial x^2} + \left(r - \frac{1}{2}\sigma^2\right)\frac{\partial u}{\partial x} - ru
\tag{sc04.f.4.4}
$$

**Transform 2 - Remove discount and drift:**
$$
u(x,\tau) = e^{\alpha x + \beta \tau} v(x, \tau)
\tag{sc04.f.4.5}
$$

Choose $\alpha, \beta$ to eliminate first-order terms:
$$
\alpha = -\frac{1}{2}\left(\frac{2r}{\sigma^2} - 1\right), \quad \beta = -\frac{1}{2}\left(r + \frac{\sigma^2}{4}\left(\frac{2r}{\sigma^2} + 1\right)^2\right)
\tag{sc04.f.4.6}
$$

**Result:** $v(x,\tau)$ satisfies the **heat equation:**
$$
\frac{\partial v}{\partial \tau} = \frac{1}{2}\sigma^2 \frac{\partial^2 v}{\partial x^2}
\tag{sc04.f.4.7}
$$

### 4.3 The Black-Scholes Formula

**After solving heat equation and transforming back:**

$$
\boxed{V(S,t) = S \Phi(d_1) - K e^{-r(T-t)} \Phi(d_2)}
\tag{sc04.f.4.8}
$$

where:
$$
\begin{aligned}
d_1 &= \frac{\log(S/K) + (r + \frac{1}{2}\sigma^2)(T-t)}{\sigma\sqrt{T-t}} \\
d_2 &= d_1 - \sigma\sqrt{T-t} = \frac{\log(S/K) + (r - \frac{1}{2}\sigma^2)(T-t)}{\sigma\sqrt{T-t}}
\end{aligned}
\tag{sc04.f.4.9}
$$

and $\Phi(\cdot)$ is the standard normal CDF.

**Interpretation:**
- $\Phi(d_1)$ = probability stock ends in-the-money (risk-neutral)
- $\Phi(d_2)$ = adjusted probability for discounting
- First term: expected stock value if exercised
- Second term: discounted strike if exercised

### 4.4 European Put Option

**By put-call parity:**
$$
P(S,t) + S = C(S,t) + Ke^{-r(T-t)}
\tag{sc04.f.4.10}
$$

Therefore:
$$
\boxed{P(S,t) = K e^{-r(T-t)} \Phi(-d_2) - S \Phi(-d_1)}
\tag{sc04.f.4.11}
$$

**Direct verification:** This also satisfies the BS PDE with boundary $V(S,T) = (K-S)^+$.

---

## 5. The Greeks - Risk Sensitivities

### 5.1 Definitions

The **Greeks** are partial derivatives of option value with respect to various parameters.

**Delta ($\Delta$):** Sensitivity to stock price
$$
\Delta = \frac{\partial V}{\partial S}
\tag{sc04.f.5.1}
$$

**Gamma ($\Gamma$):** Curvature (rate of change of Delta)
$$
\Gamma = \frac{\partial^2 V}{\partial S^2}
\tag{sc04.f.5.2}
$$

**Theta ($\Theta$):** Time decay
$$
\Theta = \frac{\partial V}{\partial t}
\tag{sc04.f.5.3}
$$

**Vega ($\mathcal{V}$):** Sensitivity to volatility
$$
\mathcal{V} = \frac{\partial V}{\partial \sigma}
\tag{sc04.f.5.4}
$$

**Rho ($\rho$):** Sensitivity to interest rate
$$
\rho = \frac{\partial V}{\partial r}
\tag{sc04.f.5.5}
$$

### 5.2 Greeks for European Call

**From sc04.f.4.8:** $C = S\Phi(d_1) - Ke^{-r\tau}\Phi(d_2)$ where $\tau = T-t$.

**Delta:**
$$
\Delta_C = \Phi(d_1)
\tag{sc04.f.5.6}
$$

**Interpretation:** $0 \leq \Delta_C \leq 1$
- Deep out-of-money: $\Delta \approx 0$ (no sensitivity)
- At-the-money: $\Delta \approx 0.5$
- Deep in-the-money: $\Delta \approx 1$ (moves with stock)

**Gamma:**
$$
\Gamma_C = \frac{\phi(d_1)}{S\sigma\sqrt{\tau}}
\tag{sc04.f.5.7}
$$

where $\phi(x) = \frac{1}{\sqrt{2\pi}}e^{-x^2/2}$ is standard normal PDF.

**Interpretation:**
- Maximum at-the-money
- Increases as $t \to T$ (rapid changes near expiry)
- Same for calls and puts: $\Gamma_C = \Gamma_P$

**Theta:**
$$
\Theta_C = -\frac{S\phi(d_1)\sigma}{2\sqrt{\tau}} - rKe^{-r\tau}\Phi(d_2)
\tag{sc04.f.5.8}
$$

**Interpretation:** Usually negative (time decay) for long options.

**Vega:**
$$
\mathcal{V}_C = S\sqrt{\tau}\,\phi(d_1)
\tag{sc04.f.5.9}
$$

**Interpretation:**
- Always positive for long options
- Maximum at-the-money
- Long options benefit from increased volatility

**Rho:**
$$
\rho_C = K\tau e^{-r\tau}\Phi(d_2)
\tag{sc04.f.5.10}
$$

### 5.3 Greeks for European Put

**Delta:**
$$
\Delta_P = \Phi(d_1) - 1 = -\Phi(-d_1)
\tag{sc04.f.5.11}
$$

**Interpretation:** $-1 \leq \Delta_P \leq 0$ (inverse relationship with stock)

**Gamma:** Same as call
$$
\Gamma_P = \Gamma_C = \frac{\phi(d_1)}{S\sigma\sqrt{\tau}}
\tag{sc04.f.5.12}
$$

**Theta:**
$$
\Theta_P = -\frac{S\phi(d_1)\sigma}{2\sqrt{\tau}} + rKe^{-r\tau}\Phi(-d_2)
\tag{sc04.f.5.13}
$$

**Vega:** Same as call
$$
\mathcal{V}_P = \mathcal{V}_C = S\sqrt{\tau}\,\phi(d_1)
\tag{sc04.f.5.14}
$$

**Rho:**
$$
\rho_P = -K\tau e^{-r\tau}\Phi(-d_2)
\tag{sc04.f.5.15}
$$

### 5.4 The Black-Scholes PDE in Terms of Greeks

Rewrite sc04.f.2.12:
$$
\boxed{\Theta + \frac{1}{2}\sigma^2 S^2 \Gamma + rS\Delta - rV = 0}
\tag{sc04.f.5.16}
$$

**Interpretation:**
- For a **delta-hedged portfolio** ($\Delta = 0$): $\Theta + \frac{1}{2}\sigma^2 S^2 \Gamma = rV$
- Time decay ($\Theta$) balances convexity ($\Gamma$) to earn risk-free rate

---

## 6. Hedging and Risk Management

### 6.1 Delta Hedging

**Strategy:** Hold $\phi_t = \Delta$ units of stock to replicate option.

**From sc04.f.2.7:** $\phi_t = \frac{\partial V}{\partial S} = \Delta$

**For call:** Hold $\Phi(d_1)$ shares per call sold
**For put:** Hold $\Phi(d_1) - 1$ shares per put sold

**Rebalancing:** $\Delta$ changes with stock price and time $\implies$ continuous rebalancing needed (in theory).

**Practice:** Discrete rebalancing introduces **hedging error**.

### 6.2 Gamma Hedging

**Problem:** Delta hedge only works for small moves. For large moves, $\Gamma$ matters.

**Second-order approximation:**
$$
\Delta V \approx \Delta \cdot \Delta S + \frac{1}{2}\Gamma \cdot (\Delta S)^2
\tag{sc04.f.6.1}
$$

**Gamma hedge:** Add positions in other options to neutralize both $\Delta$ and $\Gamma$.

**Example:** Short call position with $\Delta = \Delta_1, \Gamma = \Gamma_1$. Hedge with:
- $n_2$ units of another call with $\Delta = \Delta_2, \Gamma = \Gamma_2$
- $n_S$ units of stock

**System:**
$$
\begin{aligned}
\Delta_1 + n_2 \Delta_2 + n_S &= 0 \quad \text{(delta neutral)} \\
\Gamma_1 + n_2 \Gamma_2 &= 0 \quad \text{(gamma neutral)}
\end{aligned}
\tag{sc04.f.6.2}
$$

**Solve:** $n_2 = -\Gamma_1/\Gamma_2$, $n_S = -\Delta_1 - n_2\Delta_2$

### 6.3 Vega Hedging

**Volatility risk:** Real volatility $\neq$ implied volatility used in pricing.

**Vega exposure:** $\mathcal{V} = \frac{\partial V}{\partial \sigma}$ measures profit/loss from 1% change in $\sigma$.

**Hedge:** Use other options to neutralize vega (similar to gamma hedging).

---

## 7. Boundary Conditions and Qualitative Behavior

### 7.1 Boundary Conditions for Call

**At expiry ($t = T$):**
$$
V(S,T) = \max(S - K, 0)
\tag{sc04.f.7.1}
$$

**As $S \to 0$:**
$$
V(0,t) = 0 \quad \text{(worthless if stock is worthless)}
\tag{sc04.f.7.2}
$$

**As $S \to \infty$:**
$$
V(S,t) \sim S - Ke^{-r(T-t)} \quad \text{(behaves like forward)}
\tag{sc04.f.7.3}
$$

### 7.2 Qualitative Properties

**Monotonicity:**
- $\frac{\partial V}{\partial S} \geq 0$ (call value increases with stock price)
- $\frac{\partial V}{\partial \sigma} \geq 0$ (benefits from volatility)
- $\frac{\partial V}{\partial \tau} \geq 0$ (more time = more value)

**Convexity:**
- $\frac{\partial^2 V}{\partial S^2} \geq 0$ (Gamma always positive)

**No early exercise (European call on non-dividend stock):**
- $V(S,t) \geq (S - K)^+$ always
- Early exercise never optimal

### 7.3 Put-Call Parity (Revisited)

**From arbitrage:**
$$
C(S,t) - P(S,t) = S - Ke^{-r(T-t)}
\tag{sc04.f.7.4}
$$

**Verification with BS formulas:**
$$
\begin{aligned}
C - P &= S\Phi(d_1) - Ke^{-r\tau}\Phi(d_2) - [Ke^{-r\tau}\Phi(-d_2) - S\Phi(-d_1)] \\
&= S[\Phi(d_1) + \Phi(-d_1)] - Ke^{-r\tau}[\Phi(d_2) + \Phi(-d_2)] \\
&= S - Ke^{-r\tau} \quad \checkmark
\end{aligned}
\tag{sc04.f.7.5}
$$

---

## 8. Extensions and Generalizations

### 8.1 Dividend-Paying Stocks

**Continuous dividend yield $q$:**

Replace $r$ with $r - q$ in stock drift:
$$
dS_t = (r-q)S_t dt + \sigma S_t d\tilde{W}_t
\tag{sc04.f.8.1}
$$

**Modified PDE:**
$$
\frac{\partial V}{\partial t} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} + (r-q)S\frac{\partial V}{\partial S} - rV = 0
\tag{sc04.f.8.2}
$$

**Modified call formula:**
$$
C = Se^{-q\tau}\Phi(d_1) - Ke^{-r\tau}\Phi(d_2)
\tag{sc04.f.8.3}
$$

where now:
$$
d_1 = \frac{\log(S/K) + (r - q + \frac{1}{2}\sigma^2)\tau}{\sigma\sqrt{\tau}}
\tag{sc04.f.8.4}
$$

### 8.2 American Options

**Optimal exercise boundary:** Free boundary problem.

**PDE becomes variational inequality:**
$$
\max\left\{\frac{\partial V}{\partial t} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} + rS\frac{\partial V}{\partial S} - rV, \, V - (S-K)\right\} = 0
\tag{sc04.f.8.5}
$$

**Interpretation:**
- Either BS PDE holds (continuation region)
- Or $V = $ payoff (exercise region)

**Solution methods:**
- Finite difference schemes
- Binomial trees (discrete approximation)
- Integral equations (rare)

### 8.3 Implied Volatility

**Market reality:** Different strikes $\implies$ different implied $\sigma$ (volatility smile/skew)

**Inverse problem:** Given market price $V_{\text{mkt}}$, solve for $\sigma$ such that:
$$
V_{\text{BS}}(S, K, r, \sigma, T-t) = V_{\text{mkt}}
\tag{sc04.f.8.6}
$$

**No closed form:** Use Newton-Raphson with Vega as derivative.

---

## 9. Summary and Key Results

### 9.1 Main Formulas

| Concept | Formula | Reference |
|---------|---------|-----------|
| **Black-Scholes PDE** | $\frac{\partial V}{\partial t} + \frac{1}{2}\sigma^2 S^2 \frac{\partial^2 V}{\partial S^2} + rS\frac{\partial V}{\partial S} - rV = 0$ | **sc04.f.2.12** |
| Delta hedge | $\phi_t = \frac{\partial V}{\partial S}$ | sc04.f.2.7 |
| Feynman-Kac | $V = \mathbb{E}_{\mathbb{Q}}[e^{-r\tau} f(S_T) | S_t]$ solves PDE | sc04.f.3.4 |
| **Call value** | $C = S\Phi(d_1) - Ke^{-r\tau}\Phi(d_2)$ | **sc04.f.4.8** |
| Put value | $P = Ke^{-r\tau}\Phi(-d_2) - S\Phi(-d_1)$ | sc04.f.4.11 |
| Put-call parity | $C - P = S - Ke^{-r\tau}$ | sc04.f.7.4 |
| Delta (call) | $\Delta_C = \Phi(d_1)$ | sc04.f.5.6 |
| Gamma | $\Gamma = \frac{\phi(d_1)}{S\sigma\sqrt{\tau}}$ | sc04.f.5.7 |
| Vega | $\mathcal{V} = S\sqrt{\tau}\,\phi(d_1)$ | sc04.f.5.9 |
| PDE via Greeks | $\Theta + \frac{1}{2}\sigma^2 S^2\Gamma + rS\Delta - rV = 0$ | sc04.f.5.16 |

### 9.2 Key Insights

1. **PDE ⟷ Expectation:** Feynman-Kac bridges the two approaches
2. **No $\mu$ in PDE:** Risk-neutrality eliminates stock drift
3. **Delta = hedge ratio:** Partial derivative gives replicating strategy
4. **Greeks = risk measures:** All computed from PDE solution
5. **Gamma-theta tradeoff:** Delta-hedged portfolio earns risk-free rate via convexity

---

## 10. Exercises

**Exercise 10.1:** Verify that $C(S,t) = S\Phi(d_1) - Ke^{-r\tau}\Phi(d_2)$ satisfies the Black-Scholes PDE.

**Exercise 10.2:** Derive the put formula sc04.f.4.11 using put-call parity.

**Exercise 10.3:** Show that $\Delta_C - \Delta_P = 1$ (from put-call parity).

**Exercise 10.4:** For at-the-money call ($S = K$), compute $\Delta, \Gamma, \Theta$ when $r = 0.05, \sigma = 0.2, \tau = 0.25$.

**Exercise 10.5:** Prove $\Gamma_C = \Gamma_P$ directly from the formulas.

**Exercise 10.6:** Show that for a delta-hedged portfolio, $\frac{dV}{dt} = \frac{1}{2}\sigma^2 S^2 \Gamma$.

**Exercise 10.7:** Derive the modified Black-Scholes PDE for a stock paying continuous dividend yield $q$.

**Exercise 10.8 (Challenge):** Show that the Black-Scholes PDE can be transformed into the heat equation via the change of variables sc04.f.4.1 and sc04.f.4.5.

**Exercise 10.9:** A stock is at \$100, $\sigma = 30\%$, $r = 5\%$. What is the value of a 6-month call with strike \$100?

**Exercise 10.10:** For the option in Exercise 10.9, compute all five Greeks.

---

## References

**Primary Sources:**
- Baxter, M. & Rennie, A. (1996). *Financial Calculus*. Cambridge. Chapter 3.7 (pp. 95-105).
- Hull, J. (2018). *Options, Futures, and Other Derivatives*. Pearson. Chapter 15 (pp. 321-350).
- Black, F. & Scholes, M. (1973). "The Pricing of Options and Corporate Liabilities." *JPE* 81(3):637-654.

**Advanced:**
- Wilmott, P. (2006). *Paul Wilmott on Quantitative Finance*. Wiley.
- Shreve, S. (2004). *Stochastic Calculus for Finance II*. Springer. Chapter 4.
- Karatzas, I. & Shreve, S. (1998). *Brownian Motion and Stochastic Calculus*. Springer. Chapter 5.

**Numerical Methods:**
- Higham, D. (2004). *An Introduction to Financial Option Valuation*. Cambridge.
- Tavella, D. & Randall, C. (2000). *Pricing Financial Instruments: The Finite Difference Method*. Wiley.

---

**End of SC-04 Course**

*The Black-Scholes PDE unifies probability and PDEs, giving us both intuition and computational tools. The Greeks provide a complete risk management framework. With this foundation, you can price any European derivative and understand how to hedge it.*

*All formulas numbered with sc04.f.X.Y for cross-referencing. Ready for advanced applications!*
