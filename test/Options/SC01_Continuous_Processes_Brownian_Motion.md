# SC-01: Continuous Processes & Brownian Motion
# Detailed Course - Stochastic Calculus Foundations

**Course Objective:** Master the foundational concepts of continuous stochastic processes and Brownian motion, which serve as the building blocks for continuous-time financial modeling.

---

## 1. Introduction: From Discrete to Continuous

### 1.1 Motivation

Stock prices in real markets do not follow discrete tree structures. Prices can change at any instant rather than just at fixed tick-times. The discrete binomial trees from earlier chapters are only approximations to actual price movements. As time intervals $\delta t \to 0$, trees become increasingly complex and analytically intractable.

**Key Insight:** We need a continuous-time framework that is:
- **Mathematically tractable** - simple enough to manipulate analytically
- **Realistic enough** - captures essential market behavior
- **Rich enough** - supports construction of derivative pricing models

**Brownian motion** will serve as our fundamental building block, playing the same role in continuous time that binomial branching played in discrete time.

### 1.2 What is a Continuous Process?

A continuous process is guided by three principles:

1. **Temporal continuity:** Value can change at any time, not just discrete ticks
2. **Value density:** Any real number can be a value (arbitrarily fine fractions)
3. **Path continuity:** No instantaneous jumps - if value changes from 1 to 1.05, it must pass through all intermediate values

While real stock prices move in discrete ticks, treating them as continuous processes is a reasonable approximation for analytical purposes.

---

## 2. Brownian Motion: Definition and Construction

### 2.1 Historical Context

- **1900:** Louis Bachelier analyzed Paris stock exchange using random walk models
- **Early 1900s:** Robert Brown observed microscopic particles zigzagging under molecular bombardment
- **1920s-1950s:** Mathematical theory formalized (Wiener, Lévy, Itô)

The mathematical model for these random movements became known as **Brownian motion** or **Wiener process**.

### 2.2 Constructing Brownian Motion via Random Walks

We construct Brownian motion as the limit of increasingly fine random walks.

**Definition 2.1 (Random Walk $W_n(t)$):**

For positive integer $n$, define the binomial process $W_n(t)$ with:

1. $W_n(0) = 0$ (starts at origin)
2. Layer spacing: $1/n$ (time between steps)
3. Jump sizes: $\pm 1/\sqrt{n}$ (up and down moves of equal magnitude)
4. Probability measure $\mathbb{P}$: up and down probabilities both equal to $1/2$

**Mathematically:** If $X_1, X_2, \ldots$ is a sequence of independent binomial random variables taking values $+1$ or $-1$ with equal probability, then:

$$
W_n\left(\frac{i}{n}\right) = W_n\left(\frac{i-1}{n}\right) + \frac{X_i}{\sqrt{n}}, \quad \text{for all } i \geq 1
\tag{sc01.f.1.1}
$$

**Key Observation:** The scaling factor $1/\sqrt{n}$ is critical. It prevents the process from either:
- Blowing up to infinity (which would happen with fixed-size jumps)
- Collapsing to zero (which would happen with $1/n$ jumps)

**<font color="#6495ED">Remark 2.1 (Why $1/\sqrt{n}$ Scaling?)</font>**

The choice of $1/\sqrt{n}$ is not arbitrary - it is the **unique** scaling that produces a non-trivial limit. To see why, consider what happens with jump size $1/n^\alpha$ for different values of $\alpha$:

**Case 1:** $\alpha = 1$ (jump size $1/n$)
- Each jump has variance: $(1/n)^2 = 1/n^2$
- After $n$ steps: $\text{Var}(W_n(1)) = n \cdot \frac{1}{n^2} = \frac{1}{n} \to 0$ as $n \to \infty$
- **Result:** Process collapses to zero (degenerate limit)

**Case 2:** $\alpha = 0$ (constant jump size $1$)
- Each jump has variance: $1$
- After $n$ steps: $\text{Var}(W_n(1)) = n \cdot 1 = n \to \infty$ as $n \to \infty$
- **Result:** Process explodes to infinity (divergent)

**Case 3:** $\alpha = 1/2$ (jump size $1/\sqrt{n}$) ✓
- Each jump has variance: $(1/\sqrt{n})^2 = 1/n$
- After $n$ steps: $\text{Var}(W_n(1)) = n \cdot \frac{1}{n} = 1$ (constant!)
- More generally at time $t$: $\text{Var}(W_n(t)) = nt \cdot \frac{1}{n} = t$
- **Result:** Non-trivial limit with the desired property $\text{Var}(W_t) = t$

**The Deep Principle:** The $1/\sqrt{n}$ scaling perfectly balances two competing effects:
1. **Growth:** We take $n$ steps (increases like $n$)
2. **Shrinkage:** Each step has size $1/\sqrt{n}$ (decreases like $1/\sqrt{n}$)
3. **Balance:** Variance grows as $n \times (1/\sqrt{n})^2 = 1$ (stays constant)

This is fundamentally connected to the **Central Limit Theorem**, which requires dividing by $\sqrt{n}$ to get a non-trivial limit distribution. The CLT tells us that $\frac{S_n - n\mu}{\sigma\sqrt{n}} \xrightarrow{d} N(0,1)$, and the $\sqrt{n}$ denominator arises from exactly this variance accumulation principle.

**Alternative perspective:** We don't choose $1/\sqrt{n}$ to get $\text{Var}(W_t) = t$; rather, we **want** the defining property $\text{Var}(W_t) = t$ for Brownian motion, and this requirement **forces** us to use $1/\sqrt{n}$ scaling!

### 2.3 Convergence Properties

**At time $t=1$:** The process $W_n(1)$ is the sum of $n$ independent random variables, each with:
- Mean: 0
- Variance: $1/n$

Therefore:
- $\mathbb{E}[W_n(1)] = 0$
- $\text{Var}(W_n(1)) = n \cdot \frac{1}{n} = 1$

**Central Limit Theorem Application:**

As $n \to \infty$, the distribution of $W_n(1)$ converges to $N(0,1)$ (standard normal).

**More generally at time $t$:**

$$
W_n(t) = \sqrt{t}\left(\frac{\sum_{i=1}^{nt} X_i}{\sqrt{nt}}\right)
\tag{sc01.f.1.2}
$$

The term in brackets converges to $N(0,1)$, so $W_n(t)$ converges in distribution to $N(0,t)$.

**Conditional distributions also converge:**

Each $W_n$ has the property that future movements are independent of past history. The displacement $W_n(s+t) - W_n(s)$ is:
- Independent of $\mathcal{F}_s$ (history up to time $s$)
- Distributed as binomial with mean 0 and variance $t$
- Converges to $N(0,t)$ as $n \to \infty$

### 2.4 Formal Definition of Brownian Motion

**Definition 2.2 (Brownian Motion):**

The process $W = (W_t : t \geq 0)$ is a $\mathbb{P}$-Brownian motion if and only if:

**(BM.1)** $W_t$ is continuous in $t$, and $W_0 = 0$

**(BM.2)** For any $t \geq 0$, the value of $W_t$ is distributed under $\mathbb{P}$ as a normal random variable $N(0,t)$

**(BM.3)** For any $s, t \geq 0$, the increment $W_{s+t} - W_s$ is:
- Distributed as $N(0,t)$ under $\mathbb{P}$
- Independent of $\mathcal{F}_s$ (the filtration/history up to time $s$)

**Critical Point:** Condition (BM.3) is subtle and powerful. Many processes have marginal distributions $N(0,t)$ but are NOT Brownian motion. What makes Brownian motion special is that **all conditional distributions** maintain this structure.

### 2.5 Remarkable Properties of Brownian Motion
**Property 2.1 (Nowhere Differentiable):**
Although $W$ is continuous everywhere, it is (with probability 1) differentiable nowhere. The path is infinitely "jagged."

**Property 2.2 (Unbounded Range):**
Brownian motion will eventually hit any real value, no matter how large or how negative. If $W_t = 1{,}000{,}000$, it will (with probability 1) return to zero at some later time.

**Property 2.3 (Instant Recurrence):**
Once Brownian motion hits a value, it immediately hits it again infinitely often, and continues to revisit it intermittently in the future.

**Property 2.4 (Self-Similarity/Fractal):**
Brownian motion looks statistically identical at all scales. Zooming in on any section reveals the same "jaggedness" - it never smooths out.

**Alternative Names:**
- **Wiener process** (after Norbert Wiener)
- **One-dimensional Gaussian process**

---

## 3. Brownian Motion as a Stock Price Model

### 3.1 Basic Brownian Motion is Inadequate

Pure Brownian motion $W_t$ has several problems as a stock price model:

1. **Mean zero:** $\mathbb{E}[W_t] = 0$, but stocks typically grow over time
2. **Can go negative:** $\mathbb{P}(W_t < 0) > 0$ for all $t > 0$, but stock prices cannot be negative (limited liability)
3. **Constant absolute volatility:** Real stocks exhibit volatility proportional to price level

### 3.2 Brownian Motion with Drift

To address the zero-mean problem, add a deterministic trend:

$$
S_t = \sigma W_t + \mu t
\tag{sc01.f.2.1}
$$

Where:
- $\mu$ = drift parameter (expected rate of return)
- $\sigma$ = volatility parameter (noise/uncertainty level)
- $W_t$ = standard Brownian motion

**Properties:**
- $\mathbb{E}[S_t] = \mu t$ (linear growth)
- $\text{Var}(S_t) = \sigma^2 t$ (variance grows linearly)
- $S_t \sim N(\mu t, \sigma^2 t)$

**Remaining Problem:** This process can still go negative. For any $\sigma \neq 0$, $\mu$, and $T > 0$:

$$
\mathbb{P}(S_T < 0) = \mathbb{P}\left(W_T < -\frac{\mu T}{\sigma}\right) = \Phi\left(-\frac{\mu\sqrt{T}}{\sigma}\right) > 0
\tag{sc01.f.2.2}
$$

where $\Phi$ is the standard normal CDF.

### 3.3 Geometric (Exponential) Brownian Motion

To ensure positivity and proportional volatility, take the exponential:

$$
X_t = \exp(\sigma W_t + \mu t)
\tag{sc01.f.2.3}
$$

**Key Properties:**

1. **Always positive:** $X_t > 0$ for all $t$ (since $\exp(\cdot) > 0$)
2. **Multiplicative returns:** Returns are log-normally distributed
3. **Starts quietly, gets noisier:** Absolute volatility increases with price level
4. **Proportional volatility:** The ratio $dX_t/X_t$ has constant volatility $\sigma$

**Parameter Interpretation:**
- $\sigma$ = **log-volatility** (volatility of $\log X_t$)
- $\mu$ = **log-drift** (drift of $\log X_t$)

**Statistical Fit:** With appropriate parameter estimation (e.g., $\sigma = 0.178 = 17.8\%$ annual volatility, $\mu = 0.087 = 8.7\%$ annual drift), geometric Brownian motion provides reasonable fits to actual stock price data.

**Alternative Name:** Also called **exponential Brownian motion with drift**.

---

## 4. Introduction to Stochastic Calculus

### 4.1 Why Do We Need a New Calculus?

Consider a smooth differentiable function. When we "zoom in" progressively (increase magnification), the function becomes locally straight - it's built from infinitesimal line segments. **Newtonian calculus** formalizes this.

**For Brownian motion:** Zooming in does NOT produce straight lines. Due to self-similarity, each magnification reveals the same jaggedness. We cannot build Brownian motion from line segments.

**We need:** A calculus that builds processes from infinitesimal **Brownian increments** $dW_t$, not just from deterministic $dt$.

### 4.2 Stochastic Differentials

**Definition 4.1 (Stochastic Differential):**

A stochastic process $X$ has stochastic differential:

$$
dX_t = \sigma_t \, dW_t + \mu_t \, dt
\tag{sc01.f.3.1}
$$

Where:
- $\mu_t$ = **drift** (deterministic rate of change)
- $\sigma_t$ = **volatility** (stochastic rate of change)
- $dW_t$ = infinitesimal Brownian increment
- $dt$ = infinitesimal time increment

**Integral Form:**

$$
X_t = X_0 + \int_0^t \sigma_s \, dW_s + \int_0^t \mu_s \, ds
\tag{sc01.f.3.2}
$$

**Adaptedness Requirement:** Both $\sigma_t$ and $\mu_t$ must be **adapted** to the filtration $\mathcal{F}_t$ - they can depend on the history up to time $t$ but not on future information.

### 4.3 Uniqueness Results

**Theorem 4.1 (Uniqueness of Stochastic Differentials):**

Two complementary uniqueness properties hold:

1. **Process uniqueness:** If two processes $X_t$ and $\tilde{X}_t$ agree at time zero ($X_0 = \tilde{X}_0$) and have identical volatility $\sigma_t$ and drift $\mu_t$, then $X_t = \tilde{X}_t$ for all $t$.

2. **Coefficient uniqueness:** Given a process $X_t$, there is only one pair $(\sigma_t, \mu_t)$ satisfying the integral equation (sc01.f.3.2). This follows from the **Doob-Meyer decomposition**.

### 4.4 Stochastic Differential Equations (SDEs)

When $\sigma$ and $\mu$ depend on the current value of $X_t$ (and possibly $t$):

$$
dX_t = \sigma(X_t, t) \, dW_t + \mu(X_t, t) \, dt
\tag{sc01.f.3.3}
$$

This is called a **stochastic differential equation (SDE)** for $X$.

**Warning:** Unlike the general uniqueness result, SDEs:
- May have no solution
- May have multiple solutions
- May have unique solutions (depends on regularity of $\sigma$ and $\mu$)

**Contrast with ODEs:** Ordinary differential equations $df_t = \mu(f_t, t) \, dt$ have similar existence/uniqueness issues, but stochastic equations are generally harder to solve.

---

## 5. Itô's Formula: The Fundamental Theorem of Stochastic Calculus

### 5.1 Failure of the Chain Rule

In Newtonian calculus, if $f$ is a function and $y = f(x)$, then:

$$
dy = f'(x) \, dx
\tag{sc01.f.4.1}
$$

**Question:** Does this work for Brownian motion? If $Y_t = W_t^2$, is $dY_t = 2W_t \, dW_t$?

**Test via integration:** If the chain rule worked:

$$
W_t^2 = 2\int_0^t W_s \, dW_s
\tag{sc01.f.4.2}
$$

### 5.2 The Problem with Expectations

Consider the Riemann sum approximation:

$$
2\int_0^t W_s \, dW_s \approx 2\sum_{i=0}^{n-1} W\left(\frac{it}{n}\right) \left[W\left(\frac{(i+1)t}{n}\right) - W\left(\frac{it}{n}\right)\right]
\tag{sc01.f.4.3}
$$

**Key observation:** The increment $W\left(\frac{(i+1)t}{n}\right) - W\left(\frac{it}{n}\right)$ is:
- Independent of $W\left(\frac{it}{n}\right)$ by property (BM.3)
- Has mean zero

Therefore, **each term** in the sum has mean zero, so:

$$
\mathbb{E}\left[2\int_0^t W_s \, dW_s\right] = 0
\tag{sc01.f.4.4}
$$

**But:** $\mathbb{E}[W_t^2] = t \neq 0$ (from variance formula).

**Conclusion:** The Newtonian chain rule fails! We're missing something.

### 5.3 The Missing Term: $(dW_t)^2 = dt$

**Taylor expansion** for a smooth function $f$:

$$
df(W_t) = f'(W_t) \, dW_t + \frac{1}{2}f''(W_t)(dW_t)^2 + \frac{1}{6}f'''(W_t)(dW_t)^3 + \cdots
\tag{sc01.f.4.5}
$$

In Newtonian calculus, we assume $(dW_t)^2 \approx 0$. **This is wrong for Brownian motion!**

**Formal calculation:** Consider partition $\{0, t/n, 2t/n, \ldots, t\}$:

$$
\int_0^t (dW_s)^2 = \lim_{n\to\infty} \sum_{i=1}^n \left[W\left(\frac{ti}{n}\right) - W\left(\frac{t(i-1)}{n}\right)\right]^2
\tag{sc01.f.4.6}
$$

Define normalized increments:

$$
Z_{n,i} = \frac{W\left(\frac{ti}{n}\right) - W\left(\frac{t(i-1)}{n}\right)}{\sqrt{t/n}}
\tag{sc01.f.4.7}
$$

Then $Z_{n,i} \sim N(0,1)$ are IID, and:

$$
\int_0^t (dW_s)^2 = \lim_{n\to\infty} \sum_{i=1}^n \frac{t}{n} Z_{n,i}^2 = t \lim_{n\to\infty} \frac{1}{n}\sum_{i=1}^n Z_{n,i}^2
\tag{sc01.f.4.8}
$$

By the **weak law of large numbers:** $\frac{1}{n}\sum_{i=1}^n Z_{n,i}^2 \to \mathbb{E}[Z^2] = 1$.

**Key Result:**

$$
(dW_t)^2 = dt
\tag{sc01.f.4.9}
$$

**Higher powers:** It can be shown that $(dW_t)^3, (dW_t)^4, \ldots$ are all negligible compared to $dt$.

### 5.4 Itô's Formula

**Theorem 5.1 (Itô's Formula - Single Variable):**

If $X$ is a stochastic process satisfying:

$$
dX_t = \sigma_t \, dW_t + \mu_t \, dt
$$

and $f$ is a twice continuously differentiable function (in $\mathcal{C}^2$), then $Y_t := f(X_t)$ is also a stochastic process with:

$$
dY_t = f'(X_t) \sigma_t \, dW_t + \left[\mu_t f'(X_t) + \frac{1}{2}\sigma_t^2 f''(X_t)\right] dt
\tag{sc01.f.5.1}
$$

**Mnemonic form:**

$$
df(X_t) = f'(X_t) \, dX_t + \frac{1}{2}f''(X_t)(dX_t)^2
\tag{sc01.f.5.2}
$$

where we use the **multiplication rules:**
- $(dW_t)^2 = dt$
- $(dW_t)(dt) = 0$
- $(dt)^2 = 0$

### 5.5 Examples of Itô's Formula

**Example 5.1:** $f(x) = x^2$, $X_t = W_t$

- $f'(x) = 2x$, $f''(x) = 2$
- $dW_t = 1 \cdot dW_t + 0 \cdot dt$ (so $\sigma = 1, \mu = 0$)

$$
d(W_t^2) = 2W_t \, dW_t + \frac{1}{2} \cdot 1^2 \cdot 2 \, dt = 2W_t \, dW_t + dt
\tag{sc01.f.5.3}
$$

**Integral form:**

$$
W_t^2 = 2\int_0^t W_s \, dW_s + t
\tag{sc01.f.5.4}
$$

This has the correct expectation: $\mathbb{E}[W_t^2] = 0 + t = t$. ✓

**Example 5.2:** $f(x) = e^x$, $X_t = W_t$

- $f'(x) = e^x$, $f''(x) = e^x$

$$
d(e^{W_t}) = e^{W_t} \, dW_t + \frac{1}{2}e^{W_t} \, dt = e^{W_t}\left(dW_t + \frac{1}{2}dt\right)
\tag{sc01.f.5.5}
$$

**Example 5.3 (Geometric Brownian Motion):**

Let $Y_t = \sigma W_t + \mu t$, then $dY_t = \sigma \, dW_t + \mu \, dt$.

For $X_t = \exp(Y_t) = \exp(\sigma W_t + \mu t)$:

- $f(y) = e^y$, so $f'(y) = f''(y) = e^y = X_t$

$$
dX_t = \sigma X_t \, dW_t + \left[\mu X_t + \frac{1}{2}\sigma^2 X_t\right] dt = X_t\left[\sigma \, dW_t + \left(\mu + \frac{1}{2}\sigma^2\right) dt\right]
\tag{sc01.f.5.6}
$$

**Important observation:** The drift of $dX_t/X_t$ is $\mu + \frac{1}{2}\sigma^2$, NOT just $\mu$.

---

## 6. Solving Stochastic Differential Equations

### 6.1 The Doléans Exponential

**Problem:** Solve the SDE $dX_t = \sigma X_t \, dW_t$ with $X_0 = 1$.

**Inspired guess:** From Example 5.3, try exponential form. We need the drift term to vanish, so set $\mu = -\frac{1}{2}\sigma^2$:

$$
X_t = \exp\left(\sigma W_t - \frac{1}{2}\sigma^2 t\right)
\tag{sc01.f.6.1}
$$

**Verification:** From sc01.f.5.6 with $\mu = -\frac{1}{2}\sigma^2$:

$$
dX_t = X_t\left[\sigma \, dW_t + \left(-\frac{1}{2}\sigma^2 + \frac{1}{2}\sigma^2\right) dt\right] = \sigma X_t \, dW_t \quad \checkmark
\tag{sc01.f.6.2}
$$

This solution is called the **Doléans exponential** or **stochastic exponential** of Brownian motion.

### 6.2 General Geometric Brownian Motion

**Problem:** Solve $dX_t = X_t(\sigma \, dW_t + \mu \, dt)$ with $X_0 = x_0$.

**Solution:** Match drift and volatility with sc01.f.5.6:

- Volatility term: $\sigma X_t \, dW_t$ matches ✓
- Drift term: Need $\mu + \frac{1}{2}\sigma^2 = \nu$ where $\nu$ is our guess parameter

Therefore $\nu = \mu - \frac{1}{2}\sigma^2$, giving:

$$
X_t = x_0 \exp\left(\sigma W_t + \left(\mu - \frac{1}{2}\sigma^2\right)t\right)
\tag{sc01.f.6.3}
$$

**Verification:** Direct application of Itô's formula confirms this is the unique solution.

**Properties:**
- $X_t > 0$ for all $t$ (positivity)
- $\log X_t = \log x_0 + \sigma W_t + (\mu - \frac{1}{2}\sigma^2)t$ is Brownian motion with drift
- $\mathbb{E}[X_t] = x_0 e^{\mu t}$ (expected exponential growth at rate $\mu$)
- $\text{Var}(\log X_t) = \sigma^2 t$ (log-variance grows linearly)

### 6.3 The Product Rule

**Newtonian product rule:** $d(f_t g_t) = f_t \, dg_t + g_t \, df_t$

**Stochastic case:** If $X_t$ and $Y_t$ are adapted to the **same** Brownian motion $W$:

$$
\begin{aligned}
dX_t &= \sigma_t \, dW_t + \mu_t \, dt \\
dY_t &= \rho_t \, dW_t + \nu_t \, dt
\end{aligned}
\tag{sc01.f.6.4}
$$

Then:

$$
d(X_t Y_t) = X_t \, dY_t + Y_t \, dX_t + dX_t \, dY_t
\tag{sc01.f.6.5}
$$

where $dX_t \, dY_t = \sigma_t \rho_t \, dt$ (the "second-order" term).

**Expanded form:**

$$
d(X_t Y_t) = X_t \, dY_t + Y_t \, dX_t + \sigma_t \rho_t \, dt
\tag{sc01.f.6.6}
$$

**Special case:** If $X_t$ and $Y_t$ are adapted to **independent** Brownian motions, then $dX_t \, dY_t = 0$ and the Newtonian product rule holds exactly.

---

## 7. Summary and Key Takeaways

### 7.1 Main Concepts

1. **Brownian motion** is the fundamental continuous-time stochastic process
   - Defined by three properties: continuity, normal marginals, independent increments
   - Nowhere differentiable, self-similar, unbounded

2. **Geometric Brownian motion** is the standard model for stock prices
   - Ensures positivity
   - Exhibits proportional volatility
   - Log-returns are normally distributed

3. **Stochastic calculus** extends Newtonian calculus to handle Brownian increments
   - Processes have both drift ($\mu_t dt$) and volatility ($\sigma_t dW_t$) terms
   - The key innovation: $(dW_t)^2 = dt$, not zero!

4. **Itô's formula** is the chain rule for stochastic calculus
   - Includes an extra $\frac{1}{2}\sigma^2 f''$ term from the second-order behavior
   - Essential tool for manipulating SDEs and computing derivatives

5. **Doléans exponential** solves the canonical SDE $dX_t = \sigma X_t dW_t$
   - The "correction term" $-\frac{1}{2}\sigma^2 t$ arises from Itô's formula
   - Foundation for Black-Scholes stock price models

### 7.2 Fundamental Formulas Summary

| Concept | Formula | Reference |
|---------|---------|-----------|
| Random walk convergence | $W_n(i/n) = W_n((i-1)/n) + X_i/\sqrt{n}$ | sc01.f.1.1 |
| BM distribution at time t | $W_n(t) = \sqrt{t}(\sum X_i/\sqrt{nt})$ | sc01.f.1.2 |
| BM with drift | $S_t = \sigma W_t + \mu t$ | sc01.f.2.1 |
| Geometric BM | $X_t = \exp(\sigma W_t + \mu t)$ | sc01.f.2.3 |
| Stochastic differential | $dX_t = \sigma_t dW_t + \mu_t dt$ | sc01.f.3.1 |
| Key multiplication rule | $(dW_t)^2 = dt$ | sc01.f.4.9 |
| **Itô's formula** | $df(X_t) = f'(X_t)\sigma_t dW_t + [\mu_t f'(X_t) + \frac{1}{2}\sigma_t^2 f''(X_t)]dt$ | **sc01.f.5.1** |
| Doléans exponential | $X_t = \exp(\sigma W_t - \frac{1}{2}\sigma^2 t)$ | sc01.f.6.1 |
| GBM solution | $X_t = x_0\exp(\sigma W_t + (\mu - \frac{1}{2}\sigma^2)t)$ | sc01.f.6.3 |
| Stochastic product rule | $d(X_t Y_t) = X_t dY_t + Y_t dX_t + \sigma_t\rho_t dt$ | sc01.f.6.6 |

### 7.3 Next Steps

The foundations established here enable:
- **Change of measure** (Cameron-Martin-Girsanov theorem) - how Brownian motion transforms under different probability measures
- **Martingale representation** - expressing claims as stochastic integrals
- **Black-Scholes model** - arbitrage-free pricing of European options
- **Replication strategies** - constructing self-financing portfolios

These topics form the second through fourth parts of the Stochastic Calculus refresh module in your study plan.

---

## 8. Exercises for Practice

**Exercise 8.1:** Prove that the process $X_t = \sqrt{t} Z$ where $Z \sim N(0,1)$ has marginal distribution $N(0,t)$ but is NOT Brownian motion.

**Exercise 8.2:** If $W_t$ and $\tilde{W}_t$ are independent Brownian motions and $\rho \in (-1,1)$, show that $X_t = \rho W_t + \sqrt{1-\rho^2}\tilde{W}_t$ has marginal distribution $N(0,t)$. Is $X$ a Brownian motion? Why or why not?

**Exercise 8.3:** Apply Itô's formula to find $d(\exp(W_t))$ where $W_t$ is standard Brownian motion.

**Exercise 8.4:** Using the product rule (sc01.f.6.6), derive the stochastic differential of $X_t = W_t \cdot e^{W_t}$.

**Exercise 8.5:** Solve the SDE $dX_t = X_t(\sigma dW_t + \mu_t dt)$ where $\mu_t$ is a general bounded integrable function of time (not constant). Express $X_t$ in terms of $X_0$, $\sigma$, $W_t$, and $\int_0^t \mu_s ds$.

**Exercise 8.6:** Show that if $f(x) = \log x$ and $X_t$ follows $dX_t = X_t(\sigma dW_t + \mu dt)$, then $Y_t = \log X_t$ satisfies:
$$
dY_t = \sigma dW_t + \left(\mu - \frac{1}{2}\sigma^2\right)dt
$$

---

## References

**Primary Source:**
- Baxter, M. & Rennie, A. (1996). *Financial Calculus: An Introduction to Derivative Pricing*. Cambridge University Press. Chapter 3: Continuous Processes (pp. 44-98).

**Supplementary Reading:**
- Shreve, S. (2004). *Stochastic Calculus for Finance II: Continuous-Time Models*. Springer.
- Øksendal, B. (2003). *Stochastic Differential Equations*. Springer.
- Karatzas, I. & Shreve, S. (1998). *Brownian Motion and Stochastic Calculus*. Springer.

---

**End of SC-01 Course**

*Ready for discussion and questions. All formulas are numbered for easy reference.*
