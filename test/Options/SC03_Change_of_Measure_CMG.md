# SC-03: Change of Measure - Cameron-Martin-Girsanov Theorem
# Risk-Neutral Pricing and the Fundamental Theorem

**Course Objective:** Master the Cameron-Martin-Girsanov theorem and understand how changing probability measures transforms drift while preserving volatility - the foundation of risk-neutral pricing and the Black-Scholes model.

**Prerequisites:** SC-01 (Brownian Motion), SC-02 (Itô's Formula)

---

## 1. Motivation: Why Change Measures?

### 1.1 The Pricing Problem

**From Chapter 2 insight:** In discrete models, derivative prices are expectations under a **martingale measure** - a probability measure under which discounted asset prices are martingales.

**Question:** Can we find such measures in continuous time?

**Answer:** Yes! The **Cameron-Martin-Girsanov (CMG) theorem** shows that:
- Changing measures = changing drift
- Volatility remains invariant
- We can always find a measure that makes discounted stock prices martingales

### 1.2 Separation of Process and Measure

**Key principle:** A stochastic process $W_t$ is not "a Brownian motion" - it's a **$\mathbb{P}$-Brownian motion** for some measure $\mathbb{P}$.

When we write:
$$
dS_t = \mu S_t dt + \sigma S_t dW_t
\tag{sc03.f.1.1}
$$

We're describing $S_t$ with respect to measure $\mathbb{P}$ that makes $W_t$ Brownian motion.

**CMG tells us:** How does $W_t$ (and thus $S_t$) behave under a different measure $\mathbb{Q}$?

---

## 2. Radon-Nikodym Derivatives: Discrete Introduction

### 2.1 Two-Step Random Walk Example

Consider a recombinant tree with paths $\{0,1,2\}$, $\{0,1,0\}$, $\{0,-1,0\}$, $\{0,-1,-2\}$.

**Under measure $\mathbb{P}$:** Transition probabilities $p_1, p_2, p_3$ give path probabilities:
$$
\begin{aligned}
\pi_1 &= p_1 p_2 \\
\pi_2 &= p_1(1-p_2) \\
\pi_3 &= (1-p_1)p_3 \\
\pi_4 &= (1-p_1)(1-p_3)
\end{aligned}
\tag{sc03.f.2.1}
$$

**Under measure $\mathbb{Q}$:** Different probabilities $q_1, q_2, q_3$ give:
$$
\pi_1' = q_1 q_2, \quad \pi_2' = q_1(1-q_2), \quad \pi_3' = (1-q_1)q_3, \quad \pi_4' = (1-q_1)(1-q_3)
\tag{sc03.f.2.2}
$$

### 2.2 The Radon-Nikodym Derivative

**Definition 2.1 (Radon-Nikodym Derivative):**

The random variable (depends on path):
$$
\frac{d\mathbb{Q}}{d\mathbb{P}} = \frac{\pi_i'}{\pi_i} \quad \text{on path } i
\tag{sc03.f.2.3}
$$

encodes how to "distort" $\mathbb{P}$ to produce $\mathbb{Q}$.

**Key property:**
$$
\mathbb{E}_{\mathbb{Q}}(X) = \mathbb{E}_{\mathbb{P}}\left(\frac{d\mathbb{Q}}{d\mathbb{P}} \cdot X\right)
\tag{sc03.f.2.4}
$$

### 2.3 Equivalence of Measures

**Definition 2.2 (Equivalent Measures):**

$\mathbb{P}$ and $\mathbb{Q}$ are **equivalent** if they agree on what's possible:
$$
\mathbb{P}(A) > 0 \iff \mathbb{Q}(A) > 0 \quad \text{for all events } A
\tag{sc03.f.2.5}
$$

**Consequence:** We can only define $\frac{d\mathbb{Q}}{d\mathbb{P}}$ when $\mathbb{P}$ and $\mathbb{Q}$ are equivalent.

**Problem if not equivalent:** If $\mathbb{P}(A) = 0$ but $\mathbb{Q}(A) > 0$, the ratio $\frac{\mathbb{Q}(A)}{\mathbb{P}(A)}$ is undefined.

### 2.4 Radon-Nikodym Process

For time horizons $t < T$, define:
$$
\zeta_t = \mathbb{E}_{\mathbb{P}}\left(\left.\frac{d\mathbb{Q}}{d\mathbb{P}}\right| \mathcal{F}_t\right)
\tag{sc03.f.2.6}
$$

**Properties:**
- $\zeta_0 = 1$ (no information yet)
- $\zeta_T = \frac{d\mathbb{Q}}{d\mathbb{P}}$ (full horizon)
- $\zeta_t$ is a $\mathbb{P}$-martingale

**Change of measure for conditional expectations:**
$$
\mathbb{E}_{\mathbb{Q}}(X_t | \mathcal{F}_s) = \zeta_s^{-1} \mathbb{E}_{\mathbb{P}}(\zeta_t X_t | \mathcal{F}_s)
\tag{sc03.f.2.7}
$$

---

## 3. Continuous Time: Likelihood Ratios

### 3.1 Probability Densities for Brownian Motion

**Marginal density at time $t_1$:**
$$
f_{\mathbb{P}}^1(x) = \frac{1}{\sqrt{2\pi t_1}} \exp\left(-\frac{x^2}{2t_1}\right)
\tag{sc03.f.3.1}
$$

**Joint density at times $\{t_1, \ldots, t_n\}$ with values $\{x_1, \ldots, x_n\}$:**
$$
f_{\mathbb{P}}^n(x_1, \ldots, x_n) = \prod_{i=1}^n \frac{1}{\sqrt{2\pi \Delta t_i}} \exp\left(-\frac{(\Delta x_i)^2}{2\Delta t_i}\right)
\tag{sc03.f.3.2}
$$

where $\Delta x_i = x_i - x_{i-1}$ and $\Delta t_i = t_i - t_{i-1}$.

### 3.2 Continuous Radon-Nikodym Derivative

**Definition 3.1:**

For path $\omega$ and time mesh $\{t_1, \ldots, t_n\}$ becoming dense in $[0,T]$:
$$
\frac{d\mathbb{Q}}{d\mathbb{P}}(\omega) = \lim_{n \to \infty} \frac{f_{\mathbb{Q}}^n(x_1, \ldots, x_n)}{f_{\mathbb{P}}^n(x_1, \ldots, x_n)}
\tag{sc03.f.3.3}
$$

where $x_i = W_{t_i}(\omega)$.

**Heuristically:**
$$
\frac{d\mathbb{Q}}{d\mathbb{P}}(\omega) = \lim_{A \to \{\omega\}} \frac{\mathbb{Q}(A)}{\mathbb{P}(A)}
\tag{sc03.f.3.4}
$$

**Properties (carry over from discrete):**
$$
\begin{aligned}
\mathbb{E}_{\mathbb{Q}}(X_T) &= \mathbb{E}_{\mathbb{P}}\left(\frac{d\mathbb{Q}}{d\mathbb{P}} X_T\right) \\
\mathbb{E}_{\mathbb{Q}}(X_t | \mathcal{F}_s) &= \zeta_s^{-1} \mathbb{E}_{\mathbb{P}}(\zeta_t X_t | \mathcal{F}_s)
\end{aligned}
\tag{sc03.f.3.5}
$$

---

## 4. The Cameron-Martin-Girsanov Theorem

### 4.1 Simple Example: Constant Drift

**Experiment:** Define $\mathbb{Q}$ via:
$$
\frac{d\mathbb{Q}}{d\mathbb{P}} = \exp\left(-\gamma W_T - \frac{1}{2}\gamma^2 T\right)
\tag{sc03.f.4.1}
$$

**What is the distribution of $W_T$ under $\mathbb{Q}$?**

**Use moment-generating functions:** A random variable $X$ is $N(\mu, \sigma^2)$ iff:
$$
\mathbb{E}[\exp(\theta X)] = \exp\left(\theta\mu + \frac{1}{2}\theta^2 \sigma^2\right)
\tag{sc03.f.4.2}
$$

**Compute:**
$$
\begin{aligned}
\mathbb{E}_{\mathbb{Q}}(\exp(\theta W_T)) &= \mathbb{E}_{\mathbb{P}}\left(\frac{d\mathbb{Q}}{d\mathbb{P}} \exp(\theta W_T)\right) \\
&= \mathbb{E}_{\mathbb{P}}\left(\exp\left(-\gamma W_T - \frac{1}{2}\gamma^2 T + \theta W_T\right)\right) \\
&= \mathbb{E}_{\mathbb{P}}\left(\exp\left((\theta - \gamma)W_T - \frac{1}{2}\gamma^2 T\right)\right)
\end{aligned}
\tag{sc03.f.4.3}
$$

Since $W_T \sim N(0,T)$ under $\mathbb{P}$:
$$
= \exp\left(-\frac{1}{2}\gamma^2 T + \frac{1}{2}(\theta - \gamma)^2 T\right) = \exp\left(-\theta\gamma T + \frac{1}{2}\theta^2 T\right)
\tag{sc03.f.4.4}
$$

**Conclusion:** $W_T \sim N(-\gamma T, T)$ under $\mathbb{Q}$.

This is the distribution of Brownian motion **with constant drift $-\gamma$**!

### 4.2 The General Theorem

**Theorem 4.1 (Cameron-Martin-Girsanov):**

Let $W_t$ be a $\mathbb{P}$-Brownian motion and $\gamma_t$ an $\mathcal{F}$-adapted process satisfying:
$$
\mathbb{E}_{\mathbb{P}}\left[\exp\left(\frac{1}{2}\int_0^T \gamma_t^2 dt\right)\right] < \infty
\tag{sc03.f.4.5}
$$

Then there exists a measure $\mathbb{Q}$ equivalent to $\mathbb{P}$ such that:

1. **Radon-Nikodym derivative:**
$$
\frac{d\mathbb{Q}}{d\mathbb{P}} = \exp\left(-\int_0^T \gamma_t dW_t - \frac{1}{2}\int_0^T \gamma_t^2 dt\right)
\tag{sc03.f.4.6}
$$

2. **New Brownian motion:**
$$
\tilde{W}_t = W_t + \int_0^t \gamma_s ds
\tag{sc03.f.4.7}
$$
is a $\mathbb{Q}$-Brownian motion.

**In differential form:** Under $\mathbb{Q}$:
$$
dW_t = d\tilde{W}_t - \gamma_t dt
\tag{sc03.f.4.8}
$$

**Interpretation:** $W_t$ is a **drifting Brownian motion** under $\mathbb{Q}$ with drift $-\gamma_t$.

### 4.3 CMG Converse

**Theorem 4.2 (CMG Converse):**

If $\mathbb{Q}$ is equivalent to $\mathbb{P}$, then there exists $\gamma_t$ such that:
$$
\tilde{W}_t = W_t + \int_0^t \gamma_s ds
\tag{sc03.f.4.9}
$$
is a $\mathbb{Q}$-Brownian motion, and:
$$
\frac{d\mathbb{Q}}{d\mathbb{P}} = \exp\left(-\int_0^T \gamma_t dW_t - \frac{1}{2}\int_0^T \gamma_t^2 dt\right)
\tag{sc03.f.4.10}
$$

**Conclusion:** Measure changes ⟷ Drift changes (one-to-one correspondence).

---

## 5. CMG and Stochastic Processes

### 5.1 Changing Drift of General SDEs

**Problem:** Given process with SDE under $\mathbb{P}$:
$$
dX_t = \mu_t dt + \sigma_t dW_t
\tag{sc03.f.5.1}
$$

Find measure $\mathbb{Q}$ such that $X_t$ has drift $\nu_t$ under $\mathbb{Q}$.

**Solution:** Rewrite:
$$
dX_t = \sigma_t\left(dW_t + \frac{\mu_t - \nu_t}{\sigma_t} dt\right) + \nu_t dt
\tag{sc03.f.5.2}
$$

Set $\gamma_t = \frac{\mu_t - \nu_t}{\sigma_t}$. By CMG, if $\gamma_t$ satisfies the boundedness condition, then:
$$
\tilde{W}_t = W_t + \int_0^t \frac{\mu_s - \nu_s}{\sigma_s} ds
\tag{sc03.f.5.3}
$$
is $\mathbb{Q}$-Brownian motion, and:
$$
dX_t = \sigma_t d\tilde{W}_t + \nu_t dt \quad \text{(under } \mathbb{Q}\text{)}
\tag{sc03.f.5.4}
$$

**Key insight:** **Volatility $\sigma_t$ is invariant under measure change!**

### 5.2 Example 1: Drifting Brownian Motion

**Problem:** $X_t = \sigma W_t + \mu t$ under $\mathbb{P}$. Find $\mathbb{Q}$ making $X_t$ a martingale.

**Solution:** Want drift = 0, so set $\gamma_t = \mu/\sigma$ (constant). Then:
$$
\tilde{W}_t = W_t + \frac{\mu}{\sigma}t
\tag{sc03.f.5.5}
$$
is $\mathbb{Q}$-Brownian motion, and:
$$
X_t = \sigma \tilde{W}_t \quad \text{(pure } \mathbb{Q}\text{-Brownian motion)}
\tag{sc03.f.5.6}
$$

**Radon-Nikodym:**
$$
\frac{d\mathbb{Q}}{d\mathbb{P}} = \exp\left(-\frac{\mu}{\sigma} W_T - \frac{1}{2}\frac{\mu^2}{\sigma^2} T\right)
\tag{sc03.f.5.7}
$$

### 5.3 Example 2: Geometric Brownian Motion

**Problem:** $dS_t = \mu S_t dt + \sigma S_t dW_t$. Change drift to $\nu$.

**Solution:** Set $\gamma_t = \frac{\mu - \nu}{\sigma}$. Under $\mathbb{Q}$:
$$
dS_t = \sigma S_t d\tilde{W}_t + \nu S_t dt
\tag{sc03.f.5.8}
$$

**Special case - make $S_t$ a martingale:** Set $\nu = 0$:
$$
dS_t = \sigma S_t d\tilde{W}_t \quad \text{(driftless under } \mathbb{Q}\text{)}
\tag{sc03.f.5.9}
$$

This gives:
$$
\gamma_t = \frac{\mu}{\sigma}, \quad \frac{d\mathbb{Q}}{d\mathbb{P}} = \exp\left(-\frac{\mu}{\sigma}\int_0^T dW_t - \frac{1}{2}\frac{\mu^2}{\sigma^2} T\right)
\tag{sc03.f.5.10}
$$

---

## 6. Martingales and Representation

### 6.1 Martingale Definition

**Definition 6.1 (Martingale):**

A process $M_t$ is a $\mathbb{P}$-martingale iff:
1. $\mathbb{E}_{\mathbb{P}}(|M_t|) < \infty$ for all $t$
2. $\mathbb{E}_{\mathbb{P}}(M_t | \mathcal{F}_s) = M_s$ for all $s \leq t$

**Interpretation:** Expected future value = current value (no drift up or down).

### 6.2 Examples of Martingales

**Example 6.1:** $W_t$ is a $\mathbb{P}$-martingale if $W$ is $\mathbb{P}$-Brownian motion.

**Proof:**
$$
\mathbb{E}_{\mathbb{P}}(W_t | \mathcal{F}_s) = \mathbb{E}_{\mathbb{P}}(W_s + (W_t - W_s) | \mathcal{F}_s) = W_s + 0 = W_s
\tag{sc03.f.6.1}
$$

**Example 6.2:** For any claim $X$ knowable by time $T$:
$$
N_t = \mathbb{E}_{\mathbb{P}}(X | \mathcal{F}_t)
\tag{sc03.f.6.2}
$$
is a $\mathbb{P}$-martingale (by tower law of conditional expectation).

**Example 6.3:** $W_t + \gamma t$ is a $\mathbb{P}$-martingale iff $\gamma = 0$.

### 6.3 Martingale Representation Theorem

**Theorem 6.1 (Martingale Representation):**

Suppose $M_t$ is a $\mathbb{Q}$-martingale with volatility $\sigma_t$ satisfying $\sigma_t \neq 0$ (a.s.).

Then any other $\mathbb{Q}$-martingale $N_t$ can be written:
$$
N_t = N_0 + \int_0^t \phi_s dM_s
\tag{sc03.f.6.3}
$$

for some $\mathcal{F}$-adapted process $\phi_t$ with $\int_0^T \phi_t^2 \sigma_t^2 dt < \infty$ (a.s.).

**Key insight:** $\phi_t = \frac{\sigma_N(t)}{\sigma_M(t)}$ (ratio of volatilities).

### 6.4 Driftlessness Characterization

**Theorem 6.2 (Martingale ⟷ Driftless):**

If $dX_t = \sigma_t dW_t + \mu_t dt$ satisfies $\mathbb{E}\left[\left(\int_0^T \sigma_s^2 ds\right)^{1/2}\right] < \infty$, then:
$$
X \text{ is a martingale} \iff \mu_t \equiv 0
\tag{sc03.f.6.4}
$$

**For exponential processes:** If $dX_t = \sigma_t X_t dW_t$:
$$
\mathbb{E}\left[\exp\left(\frac{1}{2}\int_0^T \sigma_s^2 ds\right)\right] < \infty \implies X \text{ is a martingale}
\tag{sc03.f.6.5}
$$

---

## 7. Risk-Neutral Pricing Framework

### 7.1 Self-Financing Portfolios

**Definition 7.1 (Self-Financing):**

Portfolio $(\phi_t, \psi_t)$ with value $V_t = \phi_t S_t + \psi_t B_t$ is **self-financing** iff:
$$
dV_t = \phi_t dS_t + \psi_t dB_t
\tag{sc03.f.7.1}
$$

**Interpretation:** Value changes only from price movements, not from injections/withdrawals.

### 7.2 Replicating Strategies

**Definition 7.2 (Replicating Strategy):**

For claim $X$ at time $T$, a **replicating strategy** is a self-financing $(\phi, \psi)$ such that:
$$
V_T = \phi_T S_T + \psi_T B_T = X
\tag{sc03.f.7.2}
$$

**No-arbitrage pricing:** If replication exists, then:
$$
V_t = \phi_t S_t + \psi_t B_t \quad \text{is the unique no-arbitrage price at time } t
\tag{sc03.f.7.3}
$$

### 7.3 Three Steps to Replication

**Recipe for finding replicating strategy:**

**Step 1:** Find measure $\mathbb{Q}$ making $S_t/B_t$ a $\mathbb{Q}$-martingale

**Step 2:** Form the process:
$$
E_t = \mathbb{E}_{\mathbb{Q}}(X | \mathcal{F}_t)
\tag{sc03.f.7.4}
$$

**Step 3:** Find $\phi_t$ such that:
$$
dE_t = \phi_t dS_t
\tag{sc03.f.7.5}
$$
(using martingale representation theorem)

**Result:** $V_t = E_t = \mathbb{E}_{\mathbb{Q}}(X | \mathcal{F}_t)$ is the no-arbitrage price.

---

## 8. Black-Scholes Model

### 8.1 The Model

**Assumption:**
- **Bond:** $B_t = e^{rt}$ (constant interest rate $r$)
- **Stock:** $S_t = S_0 \exp(\sigma W_t + \mu t)$ (geometric Brownian motion)

**Stock SDE (from Itô):**
$$
dS_t = \sigma S_t dW_t + \left(\mu + \frac{1}{2}\sigma^2\right) S_t dt
\tag{sc03.f.8.1}
$$

### 8.2 Simplified Case: Zero Interest Rate

Set $r = 0$, so $B_t = 1$.

**Step 1 - Find martingale measure:**

Want $dS_t = \sigma S_t d\tilde{W}_t$ (driftless). Set:
$$
\gamma = \frac{\mu + \frac{1}{2}\sigma^2}{\sigma}
\tag{sc03.f.8.2}
$$

Under $\mathbb{Q}$ with $\tilde{W}_t = W_t + \gamma t$:
$$
dS_t = \sigma S_t d\tilde{W}_t \quad \text{(pure martingale)}
\tag{sc03.f.8.3}
$$

**Step 2 - Price process:**

For claim $X = f(S_T)$ at time $T$:
$$
V_t = \mathbb{E}_{\mathbb{Q}}(f(S_T) | \mathcal{F}_t)
\tag{sc03.f.8.4}
$$

**Step 3 - Hedging strategy:**

By martingale representation:
$$
dV_t = \phi_t dS_t
\tag{sc03.f.8.5}
$$

where $\phi_t = \frac{\partial V}{\partial S}$ (the **Delta** of the option).

### 8.3 General Case: Nonzero Interest Rate

**Discounted stock price:**
$$
\tilde{S}_t = \frac{S_t}{B_t} = S_t e^{-rt}
\tag{sc03.f.8.6}
$$

**By Itô's formula:**
$$
d\tilde{S}_t = \tilde{S}_t\left[\sigma dW_t + \left(\mu - r + \frac{1}{2}\sigma^2\right) dt\right]
\tag{sc03.f.8.7}
$$

**Martingale measure:** Set $\gamma_t = \frac{\mu - r + \frac{1}{2}\sigma^2}{\sigma}$. Under $\mathbb{Q}$:
$$
d\tilde{S}_t = \sigma \tilde{S}_t d\tilde{W}_t \quad \text{(martingale)}
\tag{sc03.f.8.8}
$$

**Pricing formula:**
$$
V_t = B_t \mathbb{E}_{\mathbb{Q}}\left[\frac{X}{B_T} \bigg| \mathcal{F}_t\right] = e^{-r(T-t)} \mathbb{E}_{\mathbb{Q}}(X | \mathcal{F}_t)
\tag{sc03.f.8.9}
$$

**This is the fundamental Black-Scholes pricing formula!**

---

## 9. The Fundamental Theorems

### 9.1 First Fundamental Theorem

**Theorem 9.1 (No-Arbitrage ⟷ Martingale Measure):**

A market is **arbitrage-free** if and only if there exists an **equivalent martingale measure (EMM)** $\mathbb{Q}$ such that discounted asset prices are $\mathbb{Q}$-martingales.

**Proof sketch:**
- **($\implies$):** No arbitrage $\implies$ can price claims uniquely $\implies$ EMM exists
- **($\impliedby$):** If EMM exists, arbitrage opportunities would violate martingale property

### 9.2 Second Fundamental Theorem

**Theorem 9.2 (Completeness ⟷ Unique EMM):**

A market is **complete** (all claims can be replicated) if and only if the EMM is **unique**.

**In Black-Scholes:**
- One stock + one bond = two assets
- One source of randomness (one Brownian motion)
- $\implies$ Market is complete
- $\implies$ EMM is unique
- $\implies$ All derivatives can be priced and hedged

### 9.3 Market Price of Risk

The drift adjustment in CMG:
$$
\gamma_t = \frac{\mu - r}{\sigma}
\tag{sc03.f.9.1}
$$

is called the **market price of risk** or **Sharpe ratio**.

**Interpretation:**
- Numerator: excess return over risk-free rate
- Denominator: volatility (risk)
- Ratio: compensation per unit of risk

---

## 10. Summary and Key Results

### 10.1 Main Theorems

| Concept | Statement | Reference |
|---------|-----------|-----------|
| Radon-Nikodym (discrete) | $\mathbb{E}_{\mathbb{Q}}(X) = \mathbb{E}_{\mathbb{P}}(\frac{d\mathbb{Q}}{d\mathbb{P}} X)$ | sc03.f.2.4 |
| Equivalence | $\mathbb{P}(A) > 0 \iff \mathbb{Q}(A) > 0$ | sc03.f.2.5 |
| **CMG Theorem** | $\tilde{W}_t = W_t + \int_0^t \gamma_s ds$ is $\mathbb{Q}$-BM | **sc03.f.4.7** |
| CMG for SDEs | $dX = \sigma d\tilde{W} + \nu dt$ under $\mathbb{Q}$ | sc03.f.5.4 |
| Martingale representation | $N_t = N_0 + \int_0^t \phi_s dM_s$ | sc03.f.6.3 |
| Self-financing | $dV_t = \phi_t dS_t + \psi_t dB_t$ | sc03.f.7.1 |
| **Risk-neutral pricing** | $V_t = e^{-r(T-t)}\mathbb{E}_{\mathbb{Q}}(X \| \mathcal{F}_t)$ | **sc03.f.8.9** |

### 10.2 The Big Picture

**CMG tells us:**
1. Measure changes = drift changes (volatility invariant)
2. Can always find measure making any process a martingale
3. Radon-Nikodym derivative has explicit form

**For pricing:**
1. Find EMM $\mathbb{Q}$ (via CMG)
2. Price = discounted expectation under $\mathbb{Q}$
3. Hedge = derivative of price (martingale representation)

**This is the foundation of modern quantitative finance!**

---

## 11. Exercises

**Exercise 11.1:** For $W_t$ a $\mathbb{P}$-Brownian motion and $\gamma = 2$, compute $\frac{d\mathbb{Q}}{d\mathbb{P}}$ at $T=1$ and verify $\mathbb{E}_{\mathbb{P}}[\frac{d\mathbb{Q}}{d\mathbb{P}}] = 1$.

**Exercise 11.2:** If $dX_t = 0.5 dt + 0.2 dW_t$ under $\mathbb{P}$, find $\mathbb{Q}$ making $X_t$ a martingale. What is $\gamma_t$?

**Exercise 11.3:** Show that $M_t = \exp(\theta W_t - \frac{1}{2}\theta^2 t)$ is a $\mathbb{P}$-martingale for any constant $\theta$.

**Exercise 11.4:** For $S_t$ with $dS_t = 0.1 S_t dt + 0.3 S_t dW_t$ and $r = 0.05$, find the EMM $\mathbb{Q}$ and compute $\gamma_t$.

**Exercise 11.5:** Prove that if $(\phi_t, \psi_t)$ is self-financing, then $V_t = \phi_t S_t + \psi_t B_t$ satisfies $dV_t = \phi_t dS_t + \psi_t dB_t$.

**Exercise 11.6:** For European call option $X = \max(S_T - K, 0)$, write down the risk-neutral pricing formula $V_0 = \mathbb{E}_{\mathbb{Q}}[e^{-rT} X]$.

**Exercise 11.7 (Challenge):** Prove that the market price of risk $\gamma_t = \frac{\mu - r}{\sigma}$ is the same for all assets in the Black-Scholes market.

**Exercise 11.8:** If $\tilde{W}_t = W_t + \gamma t$ is $\mathbb{Q}$-BM, show that $\tilde{W}_t^2 - t$ is a $\mathbb{Q}$-martingale.

---

## References

**Primary Sources:**
- Baxter, M. & Rennie, A. (1996). *Financial Calculus*. Cambridge. Chapter 3.4-3.7 (pp. 63-98).
- Shreve, S. (2004). *Stochastic Calculus for Finance II*. Springer. Chapters 3-5.

**Advanced:**
- Karatzas, I. & Shreve, S. (1998). *Brownian Motion and Stochastic Calculus*. Springer. Chapter 5.
- Harrison, J.M. & Kreps, D. (1979). "Martingales and Arbitrage in Multiperiod Securities Markets." *JET*.
- Harrison, J.M. & Pliska, S. (1981). "Martingales and Stochastic Integrals in the Theory of Continuous Trading." *Stochastic Processes*.

---

**End of SC-03 Course**

*The Cameron-Martin-Girsanov theorem is the bridge between stochastic processes and derivative pricing. With this tool, we can transform any market model into a risk-neutral world where pricing becomes taking expectations.*

*All formulas numbered with sc03.f.X.Y for cross-referencing. Ready for discussion and applications!*
